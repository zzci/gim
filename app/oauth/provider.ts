import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { serverName, upstreamClientId, upstreamClientSecret, upstreamIssuer } from '@/config'
import { db } from '@/db'
import { accounts, devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens } from '@/db/schema'
import { provisionUser } from './account'
import { exchangeAuthCode, exchangeRefreshToken, signingJwk, toTokenResponse } from './tokens'

// Fixed client ID — this OIDC provider only serves Matrix auth (MSC2965)
export const DEFAULT_CLIENT_ID = 'matrix'
const issuer = `https://${serverName}/oauth`
const authCallbackUrl = `https://${serverName}/oauth/auth/callback`
const STABLE_DEVICE_SCOPE_PREFIX = 'urn:matrix:client:device:'
const MSC2967_DEVICE_SCOPE_PREFIX = 'urn:matrix:org.matrix.msc2967.client:device:'

const OAUTH_STATE_TTL = 600 // 10 minutes

function maskValue(value: string): string {
  if (value.length <= 12)
    return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ---- Upstream OIDC discovery (lazy-cached) ----

interface UpstreamConfig {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

let upstreamConfig: UpstreamConfig | null = null

async function getUpstreamConfig(): Promise<UpstreamConfig> {
  if (upstreamConfig)
    return upstreamConfig

  const res = await fetch(`${upstreamIssuer}/.well-known/openid-configuration`)
  if (!res.ok)
    throw new Error(`Failed to fetch upstream OIDC discovery: ${res.status}`)

  const doc = await res.json() as Record<string, unknown>
  upstreamConfig = {
    authorization_endpoint: doc.authorization_endpoint as string,
    token_endpoint: doc.token_endpoint as string,
    userinfo_endpoint: doc.userinfo_endpoint as string,
  }
  return upstreamConfig
}

// ---- Transient state for in-flight upstream auth flows ----

interface UpstreamAuthState {
  clientId: string
  redirectUri: string
  state: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: string
  nonce: string
  codeVerifier: string // PKCE verifier for upstream
  expiresAt: number
}

// ---- Helpers ----

/** Dynamic client registration — always returns fixed client_id */
export function registerClient(body: Record<string, unknown>): Record<string, unknown> {
  return {
    client_id: DEFAULT_CLIENT_ID,
    client_name: body.client_name || 'Matrix Client',
    redirect_uris: body.redirect_uris || [],
    grant_types: body.grant_types || ['authorization_code'],
    response_types: body.response_types || ['code'],
    token_endpoint_auth_method: body.token_endpoint_auth_method || 'none',
    application_type: body.application_type || 'web',
  }
}

export function discoveryDocument() {
  return {
    issuer,
    'authorization_endpoint': `${issuer}/auth`,
    'token_endpoint': `${issuer}/token`,
    'revocation_endpoint': `${issuer}/revoke`,
    'jwks_uri': `${issuer}/jwks`,
    'registration_endpoint': `${issuer}/register`,
    'userinfo_endpoint': `${issuer}/me`,
    'scopes_supported': [
      'openid',
      'profile',
      'urn:matrix:client:api:*',
      'urn:matrix:org.matrix.msc2967.client:api:*',
      'urn:matrix:client:device:*',
      'urn:matrix:org.matrix.msc2967.client:device:*',
    ],
    'response_types_supported': ['code'],
    'grant_types_supported': ['authorization_code', 'refresh_token'],
    'token_endpoint_auth_methods_supported': ['none', 'client_secret_basic'],
    'code_challenge_methods_supported': ['S256'],
    'subject_types_supported': ['public'],
    'id_token_signing_alg_values_supported': ['ES256'],
    'account_management_uri': `${issuer}/auth`,
    'account_management_actions_supported': ['org.matrix.cross_signing_reset', 'org.matrix.session_end', 'org.matrix.sessions_list'],
    'org.matrix.msc2965.authentication.issuer': issuer,
    'prompt_values_supported': ['create'],
  }
}

// ---- Account management action states ----

interface ActionState {
  action: string
  deviceId?: string
  codeVerifier: string
  expiresAt: number
}

function deleteDevice(deviceId: string) {
  const device = db.select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get()
  if (!device)
    return
  const { userId } = device
  const localpart = userId.split(':')[0]!.slice(1)

  // Revoke OIDC tokens scoped to this user's device
  const tokenRows = db.select({ grantId: oauthTokens.grantId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.deviceId, deviceId), eq(oauthTokens.accountId, localpart)))
    .all()
  const grantIds = new Set(tokenRows.map(r => r.grantId).filter(Boolean) as string[])
  for (const grantId of grantIds)
    db.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run()
  db.delete(oauthTokens).where(and(eq(oauthTokens.deviceId, deviceId), eq(oauthTokens.accountId, localpart))).run()

  // Clean up E2EE keys
  db.delete(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, deviceId))).run()
  db.delete(e2eeOneTimeKeys).where(and(eq(e2eeOneTimeKeys.userId, userId), eq(e2eeOneTimeKeys.deviceId, deviceId))).run()
  db.delete(e2eeFallbackKeys).where(and(eq(e2eeFallbackKeys.userId, userId), eq(e2eeFallbackKeys.deviceId, deviceId))).run()
  db.delete(e2eeToDeviceMessages).where(and(eq(e2eeToDeviceMessages.userId, userId), eq(e2eeToDeviceMessages.deviceId, deviceId))).run()

  // Delete device
  db.delete(devices).where(and(eq(devices.userId, userId), eq(devices.id, deviceId))).run()
}

const closePage = `<!DOCTYPE html>
<html><head><title>gim</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:400px;margin:80px auto;padding:0 20px;text-align:center}
button{padding:10px 24px;background:#0066cc;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:16px}</style>
</head><body>
<h2>Done</h2>
<p>You can close this window.</p>
<button onclick="window.close()">Close</button>
</body></html>`

function renderSessionsPage(userDevices: { id: string, displayName: string | null, lastSeenAt: Date | null, ipAddress: string | null }[]) {
  const rows = userDevices.map((d) => {
    const lastSeen = d.lastSeenAt ? new Date(Number(d.lastSeenAt)).toLocaleString() : '—'
    return `<tr><td>${escapeHtml(d.displayName || d.id)}</td><td><code>${escapeHtml(d.id)}</code></td><td>${escapeHtml(d.ipAddress || '—')}</td><td>${escapeHtml(lastSeen)}</td></tr>`
  }).join('\n')

  return `<!DOCTYPE html>
<html><head><title>Sessions — gim</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #ddd}
th{background:#f5f5f5}
code{font-size:0.85em;background:#f0f0f0;padding:2px 4px;border-radius:3px}
button{padding:8px 16px;background:#0066cc;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-top:16px}
</style></head><body>
<h2>Active Sessions</h2>
<table>
<tr><th>Name</th><th>Device ID</th><th>IP</th><th>Last Seen</th></tr>
${rows}
</table>
<button onclick="window.close()">Close</button>
</body></html>`
}

async function handleAccountAction(c: any, action: string) {
  const supportedActions = ['org.matrix.session_end', 'org.matrix.sessions_list', 'org.matrix.cross_signing_reset']
  if (!supportedActions.includes(action))
    return c.html(closePage)

  // All actions require upstream auth
  const upstream = await getUpstreamConfig()
  const state = randomBytes(16).toString('hex')
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  await cacheSet(`oauth:action:${state}`, {
    action,
    deviceId: c.req.query('device_id') || undefined,
    codeVerifier,
    expiresAt: Date.now() + OAUTH_STATE_TTL * 1000,
  } satisfies ActionState, { ttl: OAUTH_STATE_TTL })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: upstreamClientId,
    redirect_uri: authCallbackUrl,
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return c.redirect(`${upstream.authorization_endpoint}?${params.toString()}`)
}

// ---- Routes ----

export const oauthApp = new Hono()

// GET /.well-known/openid-configuration — discovery document
oauthApp.get('/.well-known/openid-configuration', c => c.json(discoveryDocument()))

// GET /jwks — public key for id_token verification
oauthApp.get('/jwks', (c) => {
  return c.json({ keys: [signingJwk] })
})

// GET /auth — redirect to upstream OIDC provider (or handle account management actions)
oauthApp.get('/auth', async (c) => {
  // Handle account management actions (MSC2965)
  const action = c.req.query('action')
  if (action) {
    return handleAccountAction(c, action)
  }

  const upstream = await getUpstreamConfig()

  // Preserve original OAuth params from the Matrix client
  const clientId = c.req.query('client_id') || DEFAULT_CLIENT_ID
  const redirectUri = c.req.query('redirect_uri') || ''

  // Validate redirect_uri to prevent open redirects
  if (redirectUri) {
    try {
      const parsed = new URL(redirectUri)
      const blockedSchemes = ['javascript:', 'data:', 'blob:', 'vbscript:']
      if (blockedSchemes.includes(parsed.protocol)) {
        return c.json({ errcode: 'M_INVALID_PARAM', error: 'Invalid redirect_uri scheme' }, 400)
      }
    }
    catch {
      return c.json({ errcode: 'M_INVALID_PARAM', error: 'Invalid redirect_uri' }, 400)
    }
  }
  const state = c.req.query('state') || ''
  const scope = c.req.query('scope') || 'openid'
  const codeChallenge = c.req.query('code_challenge') || ''
  const codeChallengeMethod = c.req.query('code_challenge_method') || ''
  const nonce = c.req.query('nonce') || ''
  const prompt = c.req.query('prompt') || ''
  const query = c.req.query()

  const deviceScopeToken = scope.split(/\s+/).find(token =>
    token.startsWith(STABLE_DEVICE_SCOPE_PREFIX) || token.startsWith(MSC2967_DEVICE_SCOPE_PREFIX),
  )
  const safeQuery = Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      if (key === 'code_challenge' || key === 'state' || key === 'nonce')
        return [key, maskValue(value)]
      return [key, value]
    }),
  )
  logger.debug('oauth_auth_scope_received', {
    clientId,
    query: safeQuery,
    redirectUri,
    scope,
    prompt: prompt || null,
    codeChallengeMethod: codeChallengeMethod || null,
    hasDeviceScope: !!deviceScopeToken,
    deviceScope: deviceScopeToken || null,
  })

  // Generate PKCE for upstream request
  const upstreamState = randomBytes(16).toString('hex')
  const codeVerifier = randomBytes(32).toString('base64url')
  const upstreamChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  await cacheSet(`oauth:upstream:${upstreamState}`, {
    clientId,
    redirectUri,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod,
    nonce,
    codeVerifier,
    expiresAt: Date.now() + OAUTH_STATE_TTL * 1000,
  } satisfies UpstreamAuthState, { ttl: OAUTH_STATE_TTL })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: upstreamClientId,
    redirect_uri: authCallbackUrl,
    scope: 'openid profile',
    state: upstreamState,
    code_challenge: upstreamChallenge,
    code_challenge_method: 'S256',
  })

  return c.redirect(`${upstream.authorization_endpoint}?${params.toString()}`)
})

// GET /auth/callback — handle upstream OIDC callback (auth flow + account actions)
oauthApp.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.json({ errcode: 'M_UNKNOWN', error: `Upstream authentication failed: ${error}` }, 502)
  }

  if (!code || !state) {
    return c.json({ errcode: 'M_MISSING_PARAM', error: 'Missing code or state from upstream' }, 400)
  }

  // Determine flow: account action or OAuth authorization
  const actionState = await cacheGet<ActionState>(`oauth:action:${state}`)
  const authState = actionState ? null : await cacheGet<UpstreamAuthState>(`oauth:upstream:${state}`)

  if (!actionState && !authState) {
    return c.json({ errcode: 'M_UNKNOWN', error: 'Invalid or expired upstream auth state' }, 400)
  }

  const codeVerifier = actionState?.codeVerifier || authState!.codeVerifier
  const expiresAt = actionState?.expiresAt || authState!.expiresAt

  if (actionState)
    await cacheDel(`oauth:action:${state}`)
  else
    await cacheDel(`oauth:upstream:${state}`)

  if (expiresAt < Date.now()) {
    return c.json({ errcode: 'M_UNKNOWN', error: 'Upstream auth state expired' }, 400)
  }

  const upstream = await getUpstreamConfig()

  // Exchange upstream code for tokens
  const tokenBody: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: authCallbackUrl,
    client_id: upstreamClientId,
    code_verifier: codeVerifier,
  }
  if (upstreamClientSecret)
    tokenBody.client_secret = upstreamClientSecret

  const tokenRes = await fetch(upstream.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(tokenBody),
  })

  const tokenData = await tokenRes.json() as Record<string, unknown>
  if (tokenData.error) {
    logger.error('Upstream token exchange failed:', tokenData.error_description || tokenData.error)
    return c.json({ errcode: 'M_UNKNOWN', error: 'Failed to exchange upstream authorization code' }, 502)
  }

  // Fetch userinfo from upstream
  const userinfoRes = await fetch(upstream.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  const userinfo = await userinfoRes.json() as Record<string, unknown>
  const localpart = userinfo.username as string | undefined

  if (!localpart) {
    logger.error('Upstream userinfo missing username field:', JSON.stringify(userinfo))
    return c.json({ errcode: 'M_UNKNOWN', error: 'Upstream provider did not return a username' }, 502)
  }

  // ---- Account management action flow ----
  if (actionState) {
    const userId = `@${localpart}:${serverName}`

    if (actionState.action === 'org.matrix.session_end') {
      const deviceId = actionState.deviceId
      if (deviceId) {
        const device = db.select({ userId: devices.userId })
          .from(devices)
          .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
          .get()
        if (device)
          deleteDevice(deviceId)
      }
      return c.html(closePage)
    }

    if (actionState.action === 'org.matrix.sessions_list') {
      const userDevices = db.select({
        id: devices.id,
        displayName: devices.displayName,
        lastSeenAt: devices.lastSeenAt,
        ipAddress: devices.ipAddress,
      }).from(devices).where(eq(devices.userId, userId)).all()

      return c.html(renderSessionsPage(userDevices))
    }

    return c.html(closePage)
  }

  // ---- OAuth authorization flow ----
  await provisionUser(localpart, serverName)

  const codeJti = randomBytes(16).toString('hex')
  const grantId = randomBytes(16).toString('hex')

  db.insert(oauthTokens).values({
    id: `Grant:${grantId}`,
    type: 'Grant',
    accountId: localpart,
    clientId: authState!.clientId,
    scope: authState!.scope,
    grantId,
    expiresAt: new Date(Date.now() + 14 * 86400 * 1000),
  }).run()

  db.insert(oauthTokens).values({
    id: `AuthorizationCode:${codeJti}`,
    type: 'AuthorizationCode',
    accountId: localpart,
    clientId: authState!.clientId,
    scope: authState!.scope,
    grantId,
    payload: {
      redirectUri: authState!.redirectUri,
      codeChallenge: authState!.codeChallenge || undefined,
      codeChallengeMethod: authState!.codeChallengeMethod || undefined,
      nonce: authState!.nonce || undefined,
    },
    expiresAt: new Date(Date.now() + 60 * 1000),
  }).run()

  const target = new URL(authState!.redirectUri)
  target.searchParams.set('code', codeJti)
  if (authState!.state)
    target.searchParams.set('state', authState!.state)

  return c.redirect(target.toString())
})

// POST /token — handle authorization_code and refresh_token grant types
oauthApp.post('/token', async (c) => {
  const body = await c.req.parseBody() as Record<string, string>
  const grantType = body.grant_type

  if (grantType === 'authorization_code') {
    const code = body.code
    const codeVerifier = body.code_verifier || ''
    const clientId = body.client_id || ''
    const redirectUri = body.redirect_uri || ''

    if (!code) {
      return c.json({ error: 'invalid_request', error_description: 'Missing code' }, 400)
    }

    const result = exchangeAuthCode(code, codeVerifier, clientId, redirectUri)
    if ('error' in result) {
      return c.json(result, 400)
    }
    return c.json(toTokenResponse(result))
  }

  if (grantType === 'refresh_token') {
    const refreshToken = body.refresh_token
    if (!refreshToken) {
      return c.json({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400)
    }

    const result = exchangeRefreshToken(refreshToken)
    if ('error' in result) {
      return c.json(result, 400)
    }
    return c.json(toTokenResponse(result))
  }

  return c.json({ error: 'unsupported_grant_type', error_description: `Unsupported grant type: ${grantType}` }, 400)
})

// GET /me — userinfo endpoint
oauthApp.get('/me', (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const token = auth.slice(7)
  const row = db.select()
    .from(oauthTokens)
    .where(eq(oauthTokens.id, `AccessToken:${token}`))
    .get()

  if (!row) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const userId = row.accountId?.startsWith('@') ? row.accountId : `@${row.accountId}:${serverName}`
  const account = db.select()
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()

  return c.json({
    sub: row.accountId,
    preferred_username: row.accountId,
    name: account?.displayname || row.accountId,
    displayname: account?.displayname || null,
    avatar_url: account?.avatarUrl || null,
  })
})

// POST /revoke — revoke token (RFC 7009, always 200)
oauthApp.post('/revoke', async (c) => {
  const body = await c.req.parseBody() as Record<string, string>
  const token = body.token

  if (token) {
    // Try AccessToken first, then RefreshToken
    for (const type of ['AccessToken', 'RefreshToken']) {
      const row = db.select()
        .from(oauthTokens)
        .where(eq(oauthTokens.id, `${type}:${token}`))
        .get()

      if (row?.grantId) {
        // Delete entire grant
        db.delete(oauthTokens).where(eq(oauthTokens.grantId, row.grantId)).run()
        db.delete(oauthTokens).where(eq(oauthTokens.id, `Grant:${row.grantId}`)).run()
        break
      }
    }
  }

  return c.json({})
})

// POST /register — dynamic client registration (returns fixed client_id)
oauthApp.post('/register', async (c) => {
  const body = await c.req.json() as Record<string, unknown>
  const client = registerClient(body)
  return c.json(client, 201)
})
