import { eq } from 'drizzle-orm'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { db } from '@/db'
import { accountTokens } from '@/db/schema'

interface AccountTokenCacheEntry {
  found: true
  token: string
  userId: string
  deviceId: string
  name: string
  createdAtMs: number | null
  lastUsedAtMs: number | null
}

interface AccountTokenCacheMiss {
  found: false
}

type AccountTokenCacheValue = AccountTokenCacheEntry | AccountTokenCacheMiss

export interface AccountTokenRecord {
  token: string
  userId: string
  deviceId: string
  name: string
  createdAt: Date | null
  lastUsedAt: Date | null
}

const TOKEN_CACHE_KEY_PREFIX = 'account_token:'
const TOKEN_MISS_TTL_SECONDS = 60
const LAST_USED_FLUSH_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 hours
const TOKEN_CACHE_MAX_TTL_SECONDS = Number(process.env.IM_ACCOUNT_TOKEN_CACHE_MAX_TTL_SEC || 7200) || 7200
const TOKEN_VALIDITY_SECONDS = Number(process.env.IM_ACCOUNT_TOKEN_VALIDITY_SEC || 0) || 0

const pendingLastUsedAt = new Map<string, number>()

function tokenCacheKey(token: string): string {
  return `${TOKEN_CACHE_KEY_PREFIX}${token}`
}

function toCacheEntry(row: AccountTokenRecord): AccountTokenCacheEntry {
  return {
    found: true,
    token: row.token,
    userId: row.userId,
    deviceId: row.deviceId,
    name: row.name,
    createdAtMs: row.createdAt ? row.createdAt.getTime() : null,
    lastUsedAtMs: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
  }
}

function fromCacheEntry(entry: AccountTokenCacheEntry): AccountTokenRecord {
  return {
    token: entry.token,
    userId: entry.userId,
    deviceId: entry.deviceId,
    name: entry.name,
    createdAt: entry.createdAtMs === null ? null : new Date(entry.createdAtMs),
    lastUsedAt: entry.lastUsedAtMs === null ? null : new Date(entry.lastUsedAtMs),
  }
}

function computeCacheTtlSeconds(row: AccountTokenRecord, nowMs: number): number {
  if (TOKEN_VALIDITY_SECONDS <= 0)
    return TOKEN_CACHE_MAX_TTL_SECONDS

  const createdAtMs = row.createdAt?.getTime()
  if (!createdAtMs)
    return TOKEN_CACHE_MAX_TTL_SECONDS

  const expireAtMs = createdAtMs + TOKEN_VALIDITY_SECONDS * 1000
  const remainingSec = Math.floor((expireAtMs - nowMs) / 1000)
  if (remainingSec <= 0)
    return 1
  return Math.max(1, Math.min(remainingSec, TOKEN_CACHE_MAX_TTL_SECONDS))
}

function isExpired(row: AccountTokenRecord, nowMs: number): boolean {
  if (TOKEN_VALIDITY_SECONDS <= 0)
    return false
  const createdAtMs = row.createdAt?.getTime()
  if (!createdAtMs)
    return false
  return createdAtMs + TOKEN_VALIDITY_SECONDS * 1000 <= nowMs
}

async function setTokenCache(row: AccountTokenRecord, nowMs: number): Promise<void> {
  await cacheSet(tokenCacheKey(row.token), toCacheEntry(row), { ttl: computeCacheTtlSeconds(row, nowMs) })
}

async function setTokenMissCache(token: string): Promise<void> {
  await cacheSet(tokenCacheKey(token), { found: false } satisfies AccountTokenCacheMiss, { ttl: TOKEN_MISS_TTL_SECONDS })
}

function flushLastUsedAtNow(): void {
  if (pendingLastUsedAt.size === 0)
    return

  const updates = [...pendingLastUsedAt.entries()]
  pendingLastUsedAt.clear()
  for (const [token, usedAtMs] of updates) {
    db.update(accountTokens)
      .set({ lastUsedAt: new Date(usedAtMs) })
      .where(eq(accountTokens.token, token))
      .run()
  }
}

const flushTimer = setInterval(flushLastUsedAtNow, LAST_USED_FLUSH_INTERVAL_MS)
flushTimer.unref()

export function flushAccountTokenLastUsedAt(): void {
  flushLastUsedAtNow()
}

export async function getAccountToken(token: string): Promise<AccountTokenRecord | null> {
  const nowMs = Date.now()
  const cached = await cacheGet<AccountTokenCacheValue>(tokenCacheKey(token))
  if (cached) {
    if (!cached.found)
      return null
    const row = fromCacheEntry(cached)
    if (isExpired(row, nowMs)) {
      await invalidateAccountToken(token)
      return null
    }
    return row
  }

  const dbRow = db.select().from(accountTokens).where(eq(accountTokens.token, token)).get()
  if (!dbRow) {
    await setTokenMissCache(token)
    return null
  }

  const row: AccountTokenRecord = {
    token: dbRow.token,
    userId: dbRow.userId,
    deviceId: dbRow.deviceId,
    name: dbRow.name,
    createdAt: dbRow.createdAt ? new Date(dbRow.createdAt) : null,
    lastUsedAt: dbRow.lastUsedAt ? new Date(dbRow.lastUsedAt) : null,
  }
  if (isExpired(row, nowMs)) {
    await setTokenMissCache(token)
    return null
  }

  await setTokenCache(row, nowMs)
  return row
}

export async function cacheAccountToken(row: AccountTokenRecord): Promise<void> {
  await setTokenCache(row, Date.now())
}

export async function markAccountTokenUsed(token: string, usedAtMs = Date.now()): Promise<void> {
  pendingLastUsedAt.set(token, usedAtMs)

  const cached = await cacheGet<AccountTokenCacheValue>(tokenCacheKey(token))
  if (!cached || !cached.found)
    return

  cached.lastUsedAtMs = usedAtMs
  await cacheSet(tokenCacheKey(token), cached, { ttl: computeCacheTtlSeconds(fromCacheEntry(cached), usedAtMs) })
}

export async function invalidateAccountToken(token: string): Promise<void> {
  pendingLastUsedAt.delete(token)
  await cacheDel(tokenCacheKey(token))
}

export async function invalidateAccountTokens(tokens: string[]): Promise<void> {
  for (const token of tokens) {
    await invalidateAccountToken(token)
  }
}
