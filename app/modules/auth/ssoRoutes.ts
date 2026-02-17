import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, oauthTokens } from '@/db/schema'
import { DEFAULT_CLIENT_ID } from '@/oauth/provider'
import { validateAuthCode } from '@/oauth/tokens'
import { matrixError } from '@/shared/middleware/errors'

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
