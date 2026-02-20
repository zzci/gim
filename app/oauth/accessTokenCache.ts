import { and, eq } from 'drizzle-orm'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { db } from '@/db'
import { oauthTokens } from '@/db/schema'

interface AccessTokenCacheHit {
  found: true
  token: string
  id: string
  type: string
  accountId: string | null
  deviceId: string | null
  clientId: string | null
  scope: string | null
  grantId: string | null
  expiresAtMs: number | null
  consumedAtMs: number | null
}

interface AccessTokenCacheMiss {
  found: false
}

type AccessTokenCacheValue = AccessTokenCacheHit | AccessTokenCacheMiss

export interface OAuthAccessTokenRecord {
  token: string
  id: string
  type: string
  accountId: string | null
  deviceId: string | null
  clientId: string | null
  scope: string | null
  grantId: string | null
  expiresAt: Date | null
  consumedAt: Date | null
}

const ACCESS_TOKEN_KEY_PREFIX = 'oauth_access_token:'
const ACCESS_TOKEN_MISS_TTL_SECONDS = 60
const ACCESS_TOKEN_CACHE_MAX_TTL_SECONDS = Number(process.env.IM_OAUTH_ACCESS_TOKEN_CACHE_MAX_TTL_SEC || 3600) || 3600

function toAccessTokenId(tokenOrId: string): string {
  return tokenOrId.startsWith('AccessToken:') ? tokenOrId : `AccessToken:${tokenOrId}`
}

function toTokenPart(id: string): string | null {
  return id.startsWith('AccessToken:') ? id.slice('AccessToken:'.length) : null
}

function accessTokenCacheKey(token: string): string {
  return `${ACCESS_TOKEN_KEY_PREFIX}${token}`
}

function computeAccessTokenTtlSeconds(row: OAuthAccessTokenRecord, nowMs: number): number {
  const expiresAtMs = row.expiresAt?.getTime()
  if (!expiresAtMs)
    return ACCESS_TOKEN_CACHE_MAX_TTL_SECONDS
  const remainingSec = Math.floor((expiresAtMs - nowMs) / 1000)
  if (remainingSec <= 0)
    return 1
  return Math.max(1, Math.min(remainingSec, ACCESS_TOKEN_CACHE_MAX_TTL_SECONDS))
}

function toCacheHit(row: OAuthAccessTokenRecord): AccessTokenCacheHit {
  return {
    found: true,
    token: row.token,
    id: row.id,
    type: row.type,
    accountId: row.accountId,
    deviceId: row.deviceId,
    clientId: row.clientId,
    scope: row.scope,
    grantId: row.grantId,
    expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null,
    consumedAtMs: row.consumedAt ? row.consumedAt.getTime() : null,
  }
}

function fromCacheHit(row: AccessTokenCacheHit): OAuthAccessTokenRecord {
  return {
    token: row.token,
    id: row.id,
    type: row.type,
    accountId: row.accountId,
    deviceId: row.deviceId,
    clientId: row.clientId,
    scope: row.scope,
    grantId: row.grantId,
    expiresAt: row.expiresAtMs === null ? null : new Date(row.expiresAtMs),
    consumedAt: row.consumedAtMs === null ? null : new Date(row.consumedAtMs),
  }
}

async function setAccessTokenHit(row: OAuthAccessTokenRecord, nowMs: number): Promise<void> {
  await cacheSet(accessTokenCacheKey(row.token), toCacheHit(row), { ttl: computeAccessTokenTtlSeconds(row, nowMs) })
}

async function setAccessTokenMiss(token: string): Promise<void> {
  await cacheSet(accessTokenCacheKey(token), { found: false } satisfies AccessTokenCacheMiss, { ttl: ACCESS_TOKEN_MISS_TTL_SECONDS })
}

export async function getOAuthAccessToken(token: string): Promise<OAuthAccessTokenRecord | null> {
  const cached = await cacheGet<AccessTokenCacheValue>(accessTokenCacheKey(token))
  if (cached) {
    if (!cached.found)
      return null
    return fromCacheHit(cached)
  }

  const id = toAccessTokenId(token)
  const row = db.select().from(oauthTokens).where(and(eq(oauthTokens.id, id), eq(oauthTokens.type, 'AccessToken'))).get()
  if (!row) {
    await setAccessTokenMiss(token)
    return null
  }

  const record: OAuthAccessTokenRecord = {
    token,
    id: row.id,
    type: row.type,
    accountId: row.accountId ?? null,
    deviceId: row.deviceId ?? null,
    clientId: row.clientId ?? null,
    scope: row.scope ?? null,
    grantId: row.grantId ?? null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
  }

  await setAccessTokenHit(record, Date.now())
  return record
}

export async function primeOAuthAccessTokenCache(row: OAuthAccessTokenRecord): Promise<void> {
  try {
    await setAccessTokenHit(row, Date.now())
  }
  catch (e) {
    logger.warn('prime_cache_failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

export async function invalidateOAuthAccessToken(tokenOrId: string): Promise<void> {
  const id = toAccessTokenId(tokenOrId)
  const token = toTokenPart(id)
  if (!token)
    return
  await cacheDel(accessTokenCacheKey(token))
}

export async function invalidateOAuthAccessTokensByGrantId(grantId: string): Promise<void> {
  const rows = db.select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.grantId, grantId), eq(oauthTokens.type, 'AccessToken')))
    .all()
  for (const row of rows) {
    await invalidateOAuthAccessToken(row.id)
  }
}

export async function invalidateOAuthAccessTokensByAccountId(accountId: string): Promise<void> {
  const rows = db.select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.accountId, accountId), eq(oauthTokens.type, 'AccessToken')))
    .all()
  for (const row of rows) {
    await invalidateOAuthAccessToken(row.id)
  }
}

export async function invalidateOAuthAccessTokensByAccountDevice(accountId: string, deviceId: string): Promise<void> {
  const rows = db.select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(and(
      eq(oauthTokens.accountId, accountId),
      eq(oauthTokens.deviceId, deviceId),
      eq(oauthTokens.type, 'AccessToken'),
    ))
    .all()
  for (const row of rows) {
    await invalidateOAuthAccessToken(row.id)
  }
}
