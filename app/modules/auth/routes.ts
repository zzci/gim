import type { AuthEnv } from '@/shared/middleware/auth'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens } from '@/db/schema'
import { DEFAULT_CLIENT_ID, discoveryDocument } from '@/oauth/provider'
import { exchangeRefreshToken, issueTokensViaPkce, validateAuthCode } from '@/oauth/tokens'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'
import { generateDeviceId } from '@/utils/tokens'

// --- Metadata ---

export const metadataRoute = new Hono()
metadataRoute.get('/', c => c.json(discoveryDocument()))

// --- Login ---

export const loginRoute = new Hono()

loginRoute.get('/', (c) => {
  return c.json({
    flows: [
      {
        'type': 'm.login.sso',
        'oauth_aware_preferred': true,
        'org.matrix.msc3824.delegated_oidc_compatibility': true,
      },
      { type: 'm.login.token' },
    ],
  })
})

loginRoute.post('/', async (c) => {
  const body = await c.req.json()
  const { type, device_id, initial_device_display_name } = body

  if (type !== 'm.login.token') {
    return matrixError(c, 'M_UNKNOWN', `Unsupported login type: ${type}`)
  }

  const { token } = body
  if (!token) {
    return matrixError(c, 'M_BAD_JSON', 'Missing token')
  }

  const row = db.select().from(oauthTokens).where(eq(oauthTokens.id, `LoginToken:${token}`)).get()
  if (!row) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid login token')
  }

  if (row.consumedAt) {
    return matrixError(c, 'M_FORBIDDEN', 'Login token already used')
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return matrixError(c, 'M_FORBIDDEN', 'Login token expired')
  }

  db.update(oauthTokens).set({ consumedAt: new Date() }).where(eq(oauthTokens.id, `LoginToken:${token}`)).run()

  const accountId = row.accountId
  if (!accountId) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid login token')
  }

  const userId = `@${accountId}:${serverName}`

  const account = await db.select().from(accounts).where(eq(accounts.id, userId)).limit(1)
  if (!account[0]) {
    return matrixError(c, 'M_FORBIDDEN', 'User not found')
  }

  if (account[0].isDeactivated) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  let deviceId = device_id
  if (!deviceId) {
    // Generate a unique device ID for this user with collision retry
    for (let attempt = 0; attempt < 5; attempt++) {
      deviceId = generateDeviceId()
      const existing = db.select({ id: devices.id }).from(devices).where(and(eq(devices.userId, userId), eq(devices.id, deviceId))).get()
      if (!existing)
        break
    }
  }
  const localpart = userId.split(':')[0]!.slice(1)

  await db.insert(devices).values({
    userId,
    id: deviceId,
    displayName: initial_device_display_name || null,
    ipAddress: c.req.header('x-forwarded-for') || null,
  }).onConflictDoUpdate({
    target: [devices.userId, devices.id],
    set: {
      displayName: initial_device_display_name || undefined,
      lastSeenAt: new Date(),
      ipAddress: c.req.header('x-forwarded-for') || null,
    },
  })

  const tokens = await issueTokensViaPkce(localpart, deviceId)

  logger.info('login', { userId, deviceId, type: 'm.login.token' })

  return c.json({
    user_id: userId,
    access_token: tokens.access_token,
    device_id: deviceId,
    refresh_token: tokens.refresh_token,
    expires_in_ms: tokens.expires_in * 1000,
    well_known: {
      'm.homeserver': {
        base_url: `https://${serverName}`,
      },
    },
  })
})

// --- Register ---

export const registerRoute = new Hono()

registerRoute.post('/', (c) => {
  return c.json({
    errcode: 'M_FORBIDDEN',
    error: 'Registration is disabled on this server. Use SSO to sign in.',
    flows: [],
  }, 401)
})

// --- Logout ---

export const logoutRoute = new Hono<AuthEnv>()
logoutRoute.use('/*', authMiddleware)

logoutRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const token = c.req.header('Authorization')?.slice(7)

  if (token) {
    await db.delete(oauthTokens).where(eq(oauthTokens.id, `AccessToken:${token}`))
  }

  deleteDeviceKeys(auth.userId, auth.deviceId)

  await db.delete(devices).where(and(
    eq(devices.userId, auth.userId),
    eq(devices.id, auth.deviceId),
  ))

  logger.info('logout', { userId: auth.userId, deviceId: auth.deviceId })

  return c.json({})
})

logoutRoute.post('/all', async (c) => {
  const auth = c.get('auth')

  const deviceCount = db.transaction((tx) => {
    const userDevices = tx.select({ id: devices.id }).from(devices).where(eq(devices.userId, auth.userId)).all()

    for (const d of userDevices) {
      tx.delete(e2eeDeviceKeys).where(and(
        eq(e2eeDeviceKeys.userId, auth.userId),
        eq(e2eeDeviceKeys.deviceId, d.id),
      )).run()

      tx.delete(e2eeOneTimeKeys).where(and(
        eq(e2eeOneTimeKeys.userId, auth.userId),
        eq(e2eeOneTimeKeys.deviceId, d.id),
      )).run()

      tx.delete(e2eeFallbackKeys).where(and(
        eq(e2eeFallbackKeys.userId, auth.userId),
        eq(e2eeFallbackKeys.deviceId, d.id),
      )).run()

      tx.delete(e2eeToDeviceMessages).where(and(
        eq(e2eeToDeviceMessages.userId, auth.userId),
        eq(e2eeToDeviceMessages.deviceId, d.id),
      )).run()
    }

    const localpart = auth.userId.split(':')[0]!.slice(1)
    const userTokenRows = tx.select({ grantId: oauthTokens.grantId })
      .from(oauthTokens)
      .where(eq(oauthTokens.accountId, localpart))
      .all()

    const grantIds = new Set(userTokenRows.map(r => r.grantId).filter(Boolean) as string[])
    for (const grantId of grantIds) {
      tx.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run()
    }
    tx.delete(oauthTokens).where(eq(oauthTokens.accountId, localpart)).run()

    tx.delete(devices).where(eq(devices.userId, auth.userId)).run()

    return userDevices.length
  })

  logger.info('logout_all', { userId: auth.userId, deviceCount })

  return c.json({})
})

function deleteDeviceKeys(userId: string, deviceId: string) {
  db.delete(e2eeDeviceKeys).where(and(
    eq(e2eeDeviceKeys.userId, userId),
    eq(e2eeDeviceKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, userId),
    eq(e2eeOneTimeKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeFallbackKeys).where(and(
    eq(e2eeFallbackKeys.userId, userId),
    eq(e2eeFallbackKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeToDeviceMessages).where(and(
    eq(e2eeToDeviceMessages.userId, userId),
    eq(e2eeToDeviceMessages.deviceId, deviceId),
  )).run()
}

// --- SSO ---

function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const scheme = parsed.protocol.toLowerCase()
    if (scheme === 'javascript:' || scheme === 'data:' || scheme === 'vbscript:')
      return false
    if (scheme === 'https:')
      return true
    if (scheme === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
      return true
    return false
  }
  catch {
    return false
  }
}

interface SsoState {
  redirectUrl: string
  codeVerifier: string
  expiresAt: number
}

const SSO_STATE_TTL = 600 // 10 minutes

const callbackUrl = `https://${serverName}/_matrix/client/v3/login/sso/callback`

export const ssoRedirectRoute = new Hono()

ssoRedirectRoute.get('/', async (c) => {
  const redirectUrl = c.req.query('redirectUrl')
  if (!redirectUrl)
    return matrixError(c, 'M_MISSING_PARAM', 'Missing redirectUrl parameter')

  if (!isValidRedirectUrl(redirectUrl))
    return matrixError(c, 'M_INVALID_PARAM', 'Invalid redirect URL')

  const authEndpoint = `https://${serverName}/oauth/auth`

  const state = randomBytes(16).toString('hex')
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  await cacheSet(`sso:${state}`, {
    redirectUrl,
    codeVerifier,
    expiresAt: Date.now() + SSO_STATE_TTL * 1000,
  } satisfies SsoState, { ttl: SSO_STATE_TTL })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DEFAULT_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return c.redirect(`${authEndpoint}?${params.toString()}`)
})

export const ssoCallbackRoute = new Hono()

ssoCallbackRoute.get('/', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error)
    return matrixError(c, 'M_UNKNOWN', `SSO authentication failed: ${error}`)

  if (!code || !state)
    return matrixError(c, 'M_MISSING_PARAM', 'Missing code or state')

  const ssoState = await cacheGet<SsoState>(`sso:${state}`)
  if (!ssoState)
    return matrixError(c, 'M_UNKNOWN', 'Invalid or expired SSO state')

  await cacheDel(`sso:${state}`)

  if (ssoState.expiresAt < Date.now())
    return matrixError(c, 'M_UNKNOWN', 'SSO state expired')

  const result = validateAuthCode(code, ssoState.codeVerifier, DEFAULT_CLIENT_ID, callbackUrl)

  if ('error' in result) {
    logger.error('SSO auth code validation failed:', result.error_description)
    return matrixError(c, 'M_UNKNOWN', 'Failed to exchange authorization code')
  }

  const localpart = result.accountId
  const userId = `@${localpart}:${serverName}`

  const existing = await db.select().from(accounts).where(eq(accounts.id, userId)).limit(1)
  if (!existing[0]) {
    await db.insert(accounts).values({ id: userId, displayname: localpart })
  }

  const loginJti = randomBytes(32).toString('hex')
  db.insert(oauthTokens).values({
    id: `LoginToken:${loginJti}`,
    type: 'LoginToken',
    accountId: localpart,
    expiresAt: new Date(Date.now() + 2 * 60 * 1000),
  }).run()

  if (!isValidRedirectUrl(ssoState.redirectUrl))
    return matrixError(c, 'M_INVALID_PARAM', 'Invalid redirect URL')

  const redirectTarget = new URL(ssoState.redirectUrl)
  redirectTarget.searchParams.set('loginToken', loginJti)
  return c.redirect(redirectTarget.toString())
})

// --- Refresh ---

export const refreshRoute = new Hono()

refreshRoute.post('/', async (c) => {
  const body = await c.req.json()
  const { refresh_token } = body

  if (!refresh_token) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing refresh_token')
  }

  const result = exchangeRefreshToken(refresh_token)

  if ('error' in result) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', result.error_description)
  }

  return c.json({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in_ms: result.expires_in * 1000,
  })
})
