import { Buffer } from 'node:buffer'
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { and, eq, gte, isNull, or } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { devices, oauthTokens } from '@/db/schema'
import { generateDeviceId } from '@/utils/tokens'

// ECDSA P-256 key pair for id_token signing (regenerated on restart)
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, string>
const kid = createHash('sha256').update(JSON.stringify(publicJwk)).digest('base64url').slice(0, 8)
export const signingJwk = { ...publicJwk, kid, use: 'sig', alg: 'ES256' }

const issuer = `https://${serverName}/oauth`
const ACCESS_TOKEN_TTL = 86400 // 24h in seconds
const REFRESH_TOKEN_TTL = 14 * 86400 // 14d in seconds
const GRANT_TTL = 14 * 86400 // 14d in seconds
const STABLE_DEVICE_SCOPE_PREFIX = 'urn:matrix:client:device:'
const MSC2967_DEVICE_SCOPE_PREFIX = 'urn:matrix:org.matrix.msc2967.client:device:'
const DEVICE_SCOPE_PREFIXES = [STABLE_DEVICE_SCOPE_PREFIX, MSC2967_DEVICE_SCOPE_PREFIX]

export interface TokenResult {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
  device_id?: string
  id_token?: string
  /** Internal only — not exposed in HTTP responses */
  accountId: string
}

export interface TokenError {
  error: string
  error_description: string
}

/** Strip internal fields before sending as HTTP response */
export function toTokenResponse(result: TokenResult): Omit<TokenResult, 'accountId'> {
  const { accountId: _, ...response } = result
  return response
}

function signJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'ES256', typ: 'JWT', kid }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `${headerB64}.${payloadB64}`

  const signer = createSign('SHA256')
  signer.update(input)
  const sig = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })

  return `${input}.${sig.toString('base64url')}`
}

function createIdToken(sub: string, clientId: string, nonce?: string): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: Record<string, unknown> = {
    iss: issuer,
    sub,
    aud: clientId,
    iat: now,
    exp: now + 3600,
  }
  if (nonce)
    claims.nonce = nonce
  return signJwt(claims)
}

// Validate Matrix device_id for OAuth/MSC2965 flows.
// Accept RFC3986 unreserved chars to interop with Matrix clients.
function isValidDeviceId(id: string): boolean {
  if (!id || id.length > 255)
    return false
  return /^[\w.~-]+$/.test(id)
}

function extractDeviceScope(scope: string): { deviceId: string, prefix: string } | null {
  for (const token of scope.split(/\s+/).filter(Boolean)) {
    for (const prefix of DEVICE_SCOPE_PREFIXES) {
      if (token.startsWith(prefix)) {
        const deviceId = token.slice(prefix.length)
        if (deviceId)
          return { deviceId, prefix }
      }
    }
  }
  return null
}

function upsertDeviceScope(scope: string, deviceId: string, preferredPrefix = STABLE_DEVICE_SCOPE_PREFIX): string {
  const tokens = scope.split(/\s+/).filter(Boolean)
  let replaced = false
  const next = tokens.map((token) => {
    for (const prefix of DEVICE_SCOPE_PREFIXES) {
      if (token.startsWith(prefix)) {
        replaced = true
        return `${preferredPrefix}${deviceId}`
      }
    }
    return token
  })
  if (!replaced)
    next.push(`${preferredPrefix}${deviceId}`)
  return next.join(' ')
}

function createTokenPair(
  accountId: string,
  scope: string,
  clientId = 'gim-direct',
  grantId?: string,
  nonce?: string,
): TokenResult {
  const nowMs = Date.now()

  // Extract deviceId from scope (stable + MSC2967), generate if missing or invalid
  const deviceScope = extractDeviceScope(scope)
  let deviceId = deviceScope?.deviceId || null

  if (!deviceId || !isValidDeviceId(deviceId)) {
    const userId = `@${accountId}:${serverName}`
    // Generate unique device ID with collision retry
    for (let attempt = 0; attempt < 5; attempt++) {
      deviceId = generateDeviceId()
      const existing = db.select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
        .get()
      if (!existing)
        break
    }

    // Inject device scope: replace invalid one or append.
    scope = upsertDeviceScope(scope, deviceId, deviceScope?.prefix || STABLE_DEVICE_SCOPE_PREFIX)

    // Create device record
    db.insert(devices).values({
      userId,
      id: deviceId,
    }).onConflictDoNothing().run()
  }

  // Create grant if not provided
  if (!grantId) {
    grantId = randomBytes(16).toString('hex')
    db.insert(oauthTokens).values({
      id: `Grant:${grantId}`,
      type: 'Grant',
      accountId,
      clientId,
      scope,
      grantId,
      expiresAt: new Date(nowMs + GRANT_TTL * 1000),
    }).run()
  }

  const accessJti = randomBytes(32).toString('hex')
  const refreshJti = randomBytes(32).toString('hex')

  // Create AccessToken
  db.insert(oauthTokens).values({
    id: `AccessToken:${accessJti}`,
    type: 'AccessToken',
    accountId,
    deviceId,
    clientId,
    scope,
    grantId,
    expiresAt: new Date(nowMs + ACCESS_TOKEN_TTL * 1000),
  }).run()

  // Create RefreshToken
  db.insert(oauthTokens).values({
    id: `RefreshToken:${refreshJti}`,
    type: 'RefreshToken',
    accountId,
    deviceId,
    clientId,
    scope,
    grantId,
    expiresAt: new Date(nowMs + REFRESH_TOKEN_TTL * 1000),
  }).run()

  const result: TokenResult = {
    access_token: accessJti,
    refresh_token: refreshJti,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    scope,
    device_id: deviceId!,
    accountId,
  }

  // Generate id_token when openid scope is requested
  if (scope.includes('openid')) {
    result.id_token = createIdToken(accountId, clientId, nonce)
  }

  return result
}

export interface AuthCodeInfo {
  accountId: string
  scope: string
  clientId: string
  grantId?: string
  nonce?: string
}

/**
 * Validate an authorization code (PKCE, client_id, redirect_uri).
 * Consumes the code (single-use). Returns account info without creating tokens.
 */
export function validateAuthCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): AuthCodeInfo | TokenError {
  // Atomically claim the code: delete first, then check if anything was deleted.
  // This prevents concurrent exchanges from both succeeding.
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.id, `AuthorizationCode:${code}`)).get()
  if (!row) {
    return { error: 'invalid_grant', error_description: 'Authorization code not found' }
  }

  const deleted = db.delete(oauthTokens).where(eq(oauthTokens.id, `AuthorizationCode:${code}`)).run()
  if ((deleted as any).changes === 0) {
    // Another concurrent request already consumed this code
    return { error: 'invalid_grant', error_description: 'Authorization code already used' }
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { error: 'invalid_grant', error_description: 'Authorization code expired' }
  }

  // Verify client_id
  if (row.clientId !== clientId) {
    return { error: 'invalid_grant', error_description: 'Client ID mismatch' }
  }

  // AuthorizationCode stores extra params in payload
  const payload = (row.payload || {}) as Record<string, unknown>

  // Verify redirect_uri
  if (payload.redirectUri !== redirectUri) {
    return { error: 'invalid_grant', error_description: 'Redirect URI mismatch' }
  }

  // Verify PKCE (mandatory per OAuth 2.1)
  if (!payload.codeChallenge) {
    return { error: 'invalid_grant', error_description: 'PKCE code_challenge is required' }
  }
  const expected = createHash('sha256').update(codeVerifier).digest('base64url')
  if (expected !== payload.codeChallenge) {
    return { error: 'invalid_grant', error_description: 'PKCE verification failed' }
  }

  return {
    accountId: row.accountId!,
    scope: row.scope || 'openid',
    clientId,
    grantId: row.grantId || undefined,
    nonce: payload.nonce as string | undefined,
  }
}

/**
 * Exchange an authorization code for tokens.
 * Verifies PKCE challenge, client_id, and redirect_uri.
 */
export function exchangeAuthCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): TokenResult | TokenError {
  const info = validateAuthCode(code, codeVerifier, clientId, redirectUri)
  if ('error' in info)
    return info
  return createTokenPair(info.accountId, info.scope, info.clientId, info.grantId, info.nonce)
}

/**
 * Exchange a refresh token for a new token pair.
 * Consumes the old refresh token.
 */
export function exchangeRefreshToken(
  refreshToken: string,
): TokenResult | TokenError {
  // Atomically consume the refresh token: check unconsumed + not expired in one UPDATE
  const consumed = db.update(oauthTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(oauthTokens.id, `RefreshToken:${refreshToken}`),
      isNull(oauthTokens.consumedAt),
      or(isNull(oauthTokens.expiresAt), gte(oauthTokens.expiresAt, new Date())),
    ))
    .run()

  if ((consumed as any).changes === 0) {
    const row = db.select({ id: oauthTokens.id, consumedAt: oauthTokens.consumedAt, expiresAt: oauthTokens.expiresAt })
      .from(oauthTokens)
      .where(eq(oauthTokens.id, `RefreshToken:${refreshToken}`))
      .get()
    if (!row)
      return { error: 'invalid_grant', error_description: 'Unknown refresh token' }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now())
      return { error: 'invalid_grant', error_description: 'Refresh token expired' }
    return { error: 'invalid_grant', error_description: 'Refresh token already used' }
  }

  const row = db.select().from(oauthTokens).where(eq(oauthTokens.id, `RefreshToken:${refreshToken}`)).get()
  if (!row)
    return { error: 'invalid_grant', error_description: 'Unknown refresh token' }

  const accountId = row.accountId!
  let scope = row.scope || 'openid'
  const clientId = row.clientId || 'gim-direct'
  const grantId = row.grantId || undefined

  // Preserve device_id from the old token — even if scope doesn't contain it
  // (handles tokens created before the device_id-in-scope fix)
  if (row.deviceId && !extractDeviceScope(scope)) {
    scope = upsertDeviceScope(scope, row.deviceId)
  }

  return createTokenPair(accountId, scope, clientId, grantId)
}

/**
 * Issue tokens directly via internal PKCE flow (no HTTP roundtrip).
 * Used by the login endpoint.
 */
export function issueTokensViaPkce(
  accountId: string,
  deviceId: string,
): TokenResult {
  const scope = `openid urn:matrix:client:api:* urn:matrix:client:device:${deviceId}`
  return createTokenPair(accountId, scope)
}
