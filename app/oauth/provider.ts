import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { serverName, upstreamClientId, upstreamClientSecret, upstreamIssuer } from '@/config'
import { db } from '@/db'
import {
  accounts,
  devices,
  e2eeDeviceKeys,
  e2eeFallbackKeys,
  e2eeOneTimeKeys,
  e2eeToDeviceMessages,
  oauthTokens,
} from '@/db/schema'
import {
  getOAuthAccessToken,
  invalidateOAuthAccessToken,
  invalidateOAuthAccessTokensByAccountDevice,
  invalidateOAuthAccessTokensByGrantId,
} from '@/oauth/accessTokenCache'
import {
  findLocalpartByUpstreamSub,
  isLocalpartAvailableForUpstreamSub,
  provisionUserWithUpstreamSub,
  setAccountProfileUsername,
} from './account'
import { exchangeAuthCode, exchangeRefreshToken, signingJwk, toTokenResponse } from './tokens'

// Fixed client ID — this OIDC provider only serves Matrix auth (MSC2965)
export const DEFAULT_CLIENT_ID = 'matrix'
const issuer = `https://${serverName}/oauth`
const authCallbackUrl = `https://${serverName}/oauth/auth/callback`
const STABLE_DEVICE_SCOPE_PREFIX = 'urn:matrix:client:device:'
const MSC2967_DEVICE_SCOPE_PREFIX = 'urn:matrix:org.matrix.msc2967.client:device:'

const OAUTH_STATE_TTL = 600 // 10 minutes

const registeredRedirectUris = new Set<string>()

function maskValue(value: string): string {
  if (value.length <= 12)
    return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function readJsonObject(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await res.json()
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return null
    return data as Record<string, unknown>
  }
  catch {
    return null
  }
}

// ---- Upstream OIDC discovery (lazy-cached) ----

interface UpstreamConfig {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

let upstreamConfig: UpstreamConfig | null = null
let upstreamConfigCachedAt = 0
const UPSTREAM_CONFIG_TTL = 24 * 60 * 60 * 1000

const MATRIX_LOCALPART_RE = /^[a-z0-9._=/+-]+$/

type LocalpartSource = 'preferred_username' | 'username' | 'preffered_username' | 'missing'

export function resolveUpstreamLocalpart(userinfo: Record<string, unknown>): {
  localpart: string
  source: LocalpartSource
} {
  const preferred = typeof userinfo.preferred_username === 'string'
    ? userinfo.preferred_username.trim()
    : ''
  if (preferred)
    return { localpart: preferred, source: 'preferred_username' }

  const username = typeof userinfo.username === 'string' ? userinfo.username.trim() : ''
  if (username)
    return { localpart: username, source: 'username' }

  // Compatibility: some providers use the misspelled key.
  const misspelledPreferred = typeof userinfo.preffered_username === 'string'
    ? userinfo.preffered_username.trim()
    : ''
  if (misspelledPreferred)
    return { localpart: misspelledPreferred, source: 'preffered_username' }

  return { localpart: '', source: 'missing' }
}

async function getUpstreamConfig(): Promise<UpstreamConfig> {
  if (upstreamConfig && Date.now() - upstreamConfigCachedAt < UPSTREAM_CONFIG_TTL)
    return upstreamConfig

  const res = await fetch(`${upstreamIssuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok)
    throw new Error(`Failed to fetch upstream OIDC discovery: ${res.status}`)

  const doc = (await res.json()) as Record<string, unknown>

  if (doc.issuer !== upstreamIssuer)
    throw new Error(`Upstream OIDC issuer mismatch: expected ${upstreamIssuer}, got ${doc.issuer}`)

  upstreamConfig = {
    authorization_endpoint: doc.authorization_endpoint as string,
    token_endpoint: doc.token_endpoint as string,
    userinfo_endpoint: doc.userinfo_endpoint as string,
  }
  upstreamConfigCachedAt = Date.now()
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

interface UsernameResolutionState {
  authState: UpstreamAuthState
  upstreamSub: string
  suggestedUsername: string
  checkToken: string
  expiresAt: number
}

const USERNAME_CHECK_RATE_LIMIT_WINDOW_SEC = 60
const USERNAME_CHECK_RATE_LIMIT_MAX = 30

// ---- Helpers ----

/** Dynamic client registration — always returns fixed client_id */
export function registerClient(body: Record<string, unknown>): Record<string, unknown> {
  const uris = body.redirect_uris
  if (Array.isArray(uris)) {
    for (const uri of uris) {
      if (typeof uri === 'string' && uri)
        registeredRedirectUris.add(uri)
    }
  }

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
    'account_management_actions_supported': [
      'org.matrix.cross_signing_reset',
      'org.matrix.session_end',
      'org.matrix.sessions_list',
    ],
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

async function deleteDevice(deviceId: string) {
  const device = db
    .select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get()
  if (!device)
    return
  const { userId } = device
  const localpart = userId.split(':')[0]!.slice(1)

  // Revoke OIDC tokens scoped to this user's device
  const tokenRows = db
    .select({ grantId: oauthTokens.grantId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.deviceId, deviceId), eq(oauthTokens.accountId, localpart)))
    .all()
  const grantIds = new Set(tokenRows.map(r => r.grantId).filter(Boolean) as string[])
  for (const grantId of grantIds)
    db.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run()
  db.delete(oauthTokens)
    .where(and(eq(oauthTokens.deviceId, deviceId), eq(oauthTokens.accountId, localpart)))
    .run()
  await invalidateOAuthAccessTokensByAccountDevice(localpart, deviceId)
  for (const grantId of grantIds) await invalidateOAuthAccessTokensByGrantId(grantId)

  // Clean up E2EE keys
  db.delete(e2eeDeviceKeys)
    .where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, deviceId)))
    .run()
  db.delete(e2eeOneTimeKeys)
    .where(and(eq(e2eeOneTimeKeys.userId, userId), eq(e2eeOneTimeKeys.deviceId, deviceId)))
    .run()
  db.delete(e2eeFallbackKeys)
    .where(and(eq(e2eeFallbackKeys.userId, userId), eq(e2eeFallbackKeys.deviceId, deviceId)))
    .run()
  db.delete(e2eeToDeviceMessages)
    .where(
      and(eq(e2eeToDeviceMessages.userId, userId), eq(e2eeToDeviceMessages.deviceId, deviceId)),
    )
    .run()

  // Delete device
  db.delete(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .run()
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

function renderSessionsPage(
  userDevices: {
    id: string
    displayName: string | null
    lastSeenAt: Date | null
    ipAddress: string | null
  }[],
) {
  const rows = userDevices
    .map((d) => {
      const lastSeen = d.lastSeenAt ? new Date(Number(d.lastSeenAt)).toLocaleString() : '—'
      return `<tr><td>${escapeHtml(d.displayName || d.id)}</td><td><code>${escapeHtml(d.id)}</code></td><td>${escapeHtml(d.ipAddress || '—')}</td><td>${escapeHtml(lastSeen)}</td></tr>`
    })
    .join('\n')

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

function renderUsernameResolutionPage(
  state: string,
  suggestedUsername: string,
  checkToken: string,
  error?: string,
) {
  const errorBlock = error
    ? `<p style="color:#b00020;background:#fdecea;border:1px solid #f5c2c7;padding:10px 12px;border-radius:6px">${escapeHtml(error)}</p>`
    : ''

  return `<!DOCTYPE html>
<html><head><title>Choose Username — gim</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,sans-serif;max-width:520px;margin:56px auto;padding:0 20px}
h2{margin:0 0 10px}
p{color:#333;line-height:1.5}
label{display:block;margin:16px 0 6px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font:inherit}
small{display:block;color:#666;margin-top:8px}
small#availability{margin-top:6px;min-height:18px}
button{padding:10px 16px;background:#0066cc;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-top:16px}
</style></head><body>
<h2>Choose a username</h2>
<p>Please choose a username to continue sign-in.</p>
${errorBlock}
<form method="post" action="${escapeHtml(`${issuer}/auth/resolve-username`)}">
  <input type="hidden" name="state" value="${escapeHtml(state)}">
  <label for="username">Username</label>
  <input id="username" name="username" value="${escapeHtml(suggestedUsername)}" required maxlength="255" autocomplete="username" pattern="[a-z0-9._=/+-]+">
  <small id="availability"></small>
  <small>Allowed characters: a-z, 0-9, . _ = / + -</small>
  <button type="submit">Continue</button>
</form>
<script>
(() => {
  const input = document.getElementById('username')
  const status = document.getElementById('availability')
  if (!input || !status)
    return
  const state = ${JSON.stringify(state)}
  const checkToken = ${JSON.stringify(checkToken)}
  let timer = null
  const setStatus = (text, color) => {
    status.textContent = text || ''
    status.style.color = color || '#666'
  }
  const check = async () => {
    const username = input.value.trim()
    if (!username) {
      setStatus('', '#666')
      return
    }
    try {
      const res = await fetch('/oauth/auth/check-username?state=' + encodeURIComponent(state) + '&username=' + encodeURIComponent(username), {
        credentials: 'same-origin',
        headers: { Authorization: 'Bearer ' + checkToken },
      })
      const body = await res.json()
      if (!res.ok) {
        setStatus(body.error || 'Unable to validate username.', '#b00020')
        return
      }
      if (body.available)
        setStatus('Username is available.', '#0a7f2e')
      else
        setStatus(body.error || 'Username is not available.', '#b00020')
    }
    catch {
      setStatus('Unable to validate username.', '#b00020')
    }
  }
  const schedule = () => {
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(check, 300)
  }
  input.addEventListener('input', schedule)
  input.addEventListener('blur', check)
  if (input.value.trim())
    check()
})()
</script>
</body></html>`
}

function buildOAuthRedirect(localpart: string, authState: UpstreamAuthState): string {
  const codeJti = randomBytes(16).toString('hex')
  const grantId = randomBytes(16).toString('hex')

  db.insert(oauthTokens)
    .values({
      id: `Grant:${grantId}`,
      type: 'Grant',
      accountId: localpart,
      clientId: authState.clientId,
      scope: authState.scope,
      grantId,
      expiresAt: new Date(Date.now() + 14 * 86400 * 1000),
    })
    .run()

  db.insert(oauthTokens)
    .values({
      id: `AuthorizationCode:${codeJti}`,
      type: 'AuthorizationCode',
      accountId: localpart,
      clientId: authState.clientId,
      scope: authState.scope,
      grantId,
      payload: {
        redirectUri: authState.redirectUri,
        codeChallenge: authState.codeChallenge || undefined,
        codeChallengeMethod: authState.codeChallengeMethod || undefined,
        nonce: authState.nonce || undefined,
      },
      expiresAt: new Date(Date.now() + 60 * 1000),
    })
    .run()

  const target = new URL(authState.redirectUri)
  target.searchParams.set('code', codeJti)
  if (authState.state)
    target.searchParams.set('state', authState.state)
  return target.toString()
}

async function handleAccountAction(c: any, action: string) {
  const supportedActions = [
    'org.matrix.session_end',
    'org.matrix.sessions_list',
    'org.matrix.cross_signing_reset',
  ]
  if (!supportedActions.includes(action))
    return c.html(closePage)

  // All actions require upstream auth
  const upstream = await getUpstreamConfig()
  const state = randomBytes(16).toString('hex')
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  await cacheSet(
    `oauth:action:${state}`,
    {
      action,
      deviceId: c.req.query('device_id') || undefined,
      codeVerifier,
      expiresAt: Date.now() + OAUTH_STATE_TTL * 1000,
    } satisfies ActionState,
    { ttl: OAUTH_STATE_TTL },
  )

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

  if (!redirectUri) {
    return c.json({ errcode: 'M_MISSING_PARAM', error: 'redirect_uri is required' }, 400)
  }

  // Validate redirect_uri to prevent open redirects
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

  if (registeredRedirectUris.size > 0 && !registeredRedirectUris.has(redirectUri)) {
    return c.json(
      { errcode: 'M_INVALID_PARAM', error: 'redirect_uri not registered for this client' },
      400,
    )
  }
  const state = c.req.query('state') || ''
  const scope = c.req.query('scope') || 'openid'
  const codeChallenge = c.req.query('code_challenge') || ''
  const codeChallengeMethod = c.req.query('code_challenge_method') || ''
  const nonce = c.req.query('nonce') || ''
  const prompt = c.req.query('prompt') || ''
  const query = c.req.query()

  const deviceScopeToken = scope
    .split(/\s+/)
    .find(
      token =>
        token.startsWith(STABLE_DEVICE_SCOPE_PREFIX)
        || token.startsWith(MSC2967_DEVICE_SCOPE_PREFIX),
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

  await cacheSet(
    `oauth:upstream:${upstreamState}`,
    {
      clientId,
      redirectUri,
      state,
      scope,
      codeChallenge,
      codeChallengeMethod,
      nonce,
      codeVerifier,
      expiresAt: Date.now() + OAUTH_STATE_TTL * 1000,
    } satisfies UpstreamAuthState,
    { ttl: OAUTH_STATE_TTL },
  )

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
    logger.warn('oauth_upstream_error', { error, state })
    return c.json({ errcode: 'M_UNKNOWN', error: 'Upstream authentication failed' }, 502)
  }

  if (!code || !state) {
    return c.json({ errcode: 'M_MISSING_PARAM', error: 'Missing code or state from upstream' }, 400)
  }

  // Determine flow: account action or OAuth authorization
  const actionState = await cacheGet<ActionState>(`oauth:action:${state}`)
  const authState = actionState
    ? null
    : await cacheGet<UpstreamAuthState>(`oauth:upstream:${state}`)

  if (!actionState && !authState) {
    return c.json({ errcode: 'M_UNKNOWN', error: 'Invalid or expired upstream auth state' }, 400)
  }

  const codeVerifier = actionState?.codeVerifier || authState!.codeVerifier
  const expiresAt = actionState?.expiresAt || authState!.expiresAt

  if (actionState)
    await cacheDel(`oauth:action:${state}`)
  else await cacheDel(`oauth:upstream:${state}`)

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
    signal: AbortSignal.timeout(10_000),
  })
  const tokenData = await readJsonObject(tokenRes)
  if (!tokenRes.ok || !tokenData) {
    logger.error('Upstream token endpoint returned invalid response', {
      status: tokenRes.status,
      ok: tokenRes.ok,
    })
    return c.json(
      { errcode: 'M_UNKNOWN', error: 'Failed to exchange upstream authorization code' },
      502,
    )
  }

  if (tokenData.error) {
    logger.error('Upstream token exchange failed:', tokenData.error_description || tokenData.error)
    return c.json(
      { errcode: 'M_UNKNOWN', error: 'Failed to exchange upstream authorization code' },
      502,
    )
  }
  const upstreamAccessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : ''
  if (!upstreamAccessToken) {
    logger.error('Upstream token endpoint missing access_token')
    return c.json(
      { errcode: 'M_UNKNOWN', error: 'Failed to exchange upstream authorization code' },
      502,
    )
  }

  // Fetch userinfo from upstream
  const userinfoRes = await fetch(upstream.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${upstreamAccessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  const userinfo = await readJsonObject(userinfoRes)
  if (!userinfoRes.ok || !userinfo) {
    logger.error('Upstream userinfo endpoint returned invalid response', {
      status: userinfoRes.status,
      ok: userinfoRes.ok,
    })
    return c.json(
      { errcode: 'M_UNKNOWN', error: 'Failed to retrieve upstream user profile' },
      502,
    )
  }
  const resolvedUsername = resolveUpstreamLocalpart(userinfo)
  const upstreamSub = typeof userinfo.sub === 'string' ? userinfo.sub.trim() : ''

  if (!upstreamSub) {
    logger.error(
      'Upstream userinfo missing sub field:',
      JSON.stringify(userinfo),
    )
    return c.json(
      { errcode: 'M_UNKNOWN', error: 'Upstream provider did not return a stable sub identifier' },
      502,
    )
  }

  const claimedUsername = resolvedUsername.localpart
  const existingLocalpart = await findLocalpartByUpstreamSub(upstreamSub)
  let localpart = existingLocalpart
  if (!localpart) {
    if (actionState) {
      logger.warn('oauth_action_no_local_account_for_sub', { upstreamSub, action: actionState.action })
      return c.html(closePage)
    }
    const needsManualResolution
      = resolvedUsername.source === 'missing'
        || !MATRIX_LOCALPART_RE.test(claimedUsername)
        || !isLocalpartAvailableForUpstreamSub(claimedUsername, upstreamSub, serverName)

    if (!needsManualResolution) {
      const provisioned = await provisionUserWithUpstreamSub(claimedUsername, upstreamSub, serverName)
      if (provisioned.ok) {
        localpart = provisioned.localpart
        setAccountProfileUsername(`@${localpart}:${serverName}`, claimedUsername)
      }
    }

    if (!localpart) {
      const usernameState = randomBytes(16).toString('hex')
      const checkToken = randomBytes(16).toString('hex')
      const suggestedUsername = claimedUsername
      const initialError = resolvedUsername.source === 'missing'
        ? 'Upstream did not provide a usable username. Please enter a unique username to continue.'
        : 'Username is unavailable. Please enter another username.'

      await cacheSet(
        `oauth:username:${usernameState}`,
        {
          authState: authState!,
          upstreamSub,
          suggestedUsername,
          checkToken,
          expiresAt: Date.now() + OAUTH_STATE_TTL * 1000,
        } satisfies UsernameResolutionState,
        { ttl: OAUTH_STATE_TTL },
      )
      return c.html(renderUsernameResolutionPage(usernameState, suggestedUsername, checkToken, initialError))
    }
  }

  // ---- Account management action flow ----
  if (actionState) {
    const userId = `@${localpart}:${serverName}`

    if (actionState.action === 'org.matrix.session_end') {
      const deviceId = actionState.deviceId
      if (deviceId) {
        const device = db
          .select({ userId: devices.userId })
          .from(devices)
          .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
          .get()
        if (device)
          await deleteDevice(deviceId)
      }
      return c.html(closePage)
    }

    if (actionState.action === 'org.matrix.sessions_list') {
      const userDevices = db
        .select({
          id: devices.id,
          displayName: devices.displayName,
          lastSeenAt: devices.lastSeenAt,
          ipAddress: devices.ipAddress,
        })
        .from(devices)
        .where(eq(devices.userId, userId))
        .all()

      return c.html(renderSessionsPage(userDevices))
    }

    return c.html(closePage)
  }

  // ---- OAuth authorization flow ----
  return c.redirect(buildOAuthRedirect(localpart, authState!))
})

// GET /auth/check-username — validate username availability during manual resolution
oauthApp.get('/auth/check-username', async (c) => {
  const state = c.req.query('state') || ''
  const username = (c.req.query('username') || '').trim()
  const authHeader = c.req.header('Authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!state)
    return c.json({ available: false, error: 'Missing state' }, 400)

  const usernameState = await cacheGet<UsernameResolutionState>(`oauth:username:${state}`)
  if (!usernameState || usernameState.expiresAt < Date.now())
    return c.json({ available: false, error: 'Session expired. Please restart login.' }, 400)

  if (!bearer || bearer !== usernameState.checkToken)
    return c.json({ available: false, error: 'Unauthorized username check token.' }, 401)

  const rlKey = `oauth:username:rl:${state}:${bearer}`
  const hitCount = (await cacheGet<number>(rlKey)) || 0
  if (hitCount >= USERNAME_CHECK_RATE_LIMIT_MAX) {
    return c.json({ available: false, error: 'Too many checks. Please wait and retry.' }, 429)
  }
  await cacheSet(rlKey, hitCount + 1, { ttl: USERNAME_CHECK_RATE_LIMIT_WINDOW_SEC })

  if (!username || !MATRIX_LOCALPART_RE.test(username))
    return c.json({ available: false, error: 'Invalid username format.' }, 200)

  if (!isLocalpartAvailableForUpstreamSub(username, usernameState.upstreamSub, serverName))
    return c.json({ available: false, error: 'Username is already in use.' }, 200)

  return c.json({ available: true }, 200)
})

// POST /auth/resolve-username — complete login with user-selected username
oauthApp.post('/auth/resolve-username', async (c) => {
  const body = (await c.req.parseBody()) as Record<string, string>
  const state = body.state || ''
  const inputUsername = (body.username || '').trim()

  if (!state)
    return c.json({ errcode: 'M_MISSING_PARAM', error: 'Missing state' }, 400)

  const usernameState = await cacheGet<UsernameResolutionState>(`oauth:username:${state}`)
  if (!usernameState) {
    return c.html(renderUsernameResolutionPage('', inputUsername, '', 'Session expired. Please restart login.'))
  }

  if (usernameState.expiresAt < Date.now()) {
    await cacheDel(`oauth:username:${state}`)
    return c.html(renderUsernameResolutionPage('', inputUsername, '', 'Session expired. Please restart login.'))
  }

  if (!inputUsername || !MATRIX_LOCALPART_RE.test(inputUsername)) {
    return c.html(renderUsernameResolutionPage(state, inputUsername, usernameState.checkToken, 'Invalid username format.'))
  }

  if (!isLocalpartAvailableForUpstreamSub(inputUsername, usernameState.upstreamSub, serverName)) {
    return c.html(renderUsernameResolutionPage(state, inputUsername, usernameState.checkToken, 'Username is already in use.'))
  }

  const provisioned = await provisionUserWithUpstreamSub(
    inputUsername,
    usernameState.upstreamSub,
    serverName,
  )
  if (!provisioned.ok) {
    return c.html(renderUsernameResolutionPage(state, inputUsername, usernameState.checkToken, 'Username is already in use.'))
  }

  setAccountProfileUsername(`@${provisioned.localpart}:${serverName}`, inputUsername)
  await cacheDel(`oauth:username:${state}`)
  return c.redirect(buildOAuthRedirect(provisioned.localpart, usernameState.authState))
})

// POST /token — handle authorization_code and refresh_token grant types
oauthApp.post('/token', async (c) => {
  const body = (await c.req.parseBody()) as Record<string, string>
  const grantType = body.grant_type

  if (grantType === 'authorization_code') {
    const code = body.code
    const codeVerifier = body.code_verifier || ''
    const clientId = body.client_id || ''
    const redirectUri = body.redirect_uri || ''

    if (!code) {
      return c.json({ error: 'invalid_request', error_description: 'Missing code' }, 400)
    }

    const result = await exchangeAuthCode(code, codeVerifier, clientId, redirectUri)
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

    const result = await exchangeRefreshToken(refreshToken)
    if ('error' in result) {
      return c.json(result, 400)
    }
    return c.json(toTokenResponse(result))
  }

  return c.json(
    { error: 'unsupported_grant_type', error_description: `Unsupported grant type: ${grantType}` },
    400,
  )
})

// GET /me — userinfo endpoint
oauthApp.get('/me', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const token = auth.slice(7)
  const row = await getOAuthAccessToken(token)

  if (!row) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  if (row.consumedAt) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const userId = row.accountId?.startsWith('@') ? row.accountId : `@${row.accountId}:${serverName}`
  const account = db.select().from(accounts).where(eq(accounts.id, userId)).get()

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
  const body = (await c.req.parseBody()) as Record<string, string>
  const token = body.token

  if (token) {
    // Try AccessToken first, then RefreshToken
    for (const type of ['AccessToken', 'RefreshToken']) {
      const row = db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.id, `${type}:${token}`))
        .get()

      if (row?.grantId) {
        // Invalidate cache BEFORE deleting DB rows (cache invalidation queries DB)
        await invalidateOAuthAccessTokensByGrantId(row.grantId)
        // Then delete DB rows
        db.delete(oauthTokens).where(eq(oauthTokens.grantId, row.grantId)).run()
        db.delete(oauthTokens)
          .where(eq(oauthTokens.id, `Grant:${row.grantId}`))
          .run()
        break
      }
      if (type === 'AccessToken') {
        await invalidateOAuthAccessToken(token)
      }
    }
  }

  return c.json({})
})

// POST /register — dynamic client registration (returns fixed client_id)
oauthApp.post('/register', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>
  const client = registerClient(body)
  return c.json(client, 201)
})
