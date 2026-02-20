import { eq } from 'drizzle-orm'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { db } from '@/db'
import { accounts } from '@/db/schema'

const ACCOUNT_CACHE_TTL = 300 // 5 minutes in seconds

export type AccountRow = typeof accounts.$inferSelect

/** Check if an account is deactivated (cached, 5min TTL). */
export async function isDeactivated(userId: string): Promise<boolean> {
  const cached = await cacheGet<boolean>(`m:ad:${userId}`)
  if (cached !== null)
    return cached

  const account = db.select({ isDeactivated: accounts.isDeactivated })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()
  const result = !!account?.isDeactivated
  await cacheSet(`m:ad:${userId}`, result, { ttl: ACCOUNT_CACHE_TTL })
  return result
}

/** Get a user's display name (cached, 5min TTL). */
export async function getDisplayName(userId: string): Promise<string | null> {
  const cacheKey = `m:dn:${userId}`
  const cached = await cacheGet<string | null>(cacheKey)
  if (cached !== null)
    return cached

  const account = db.select({ displayname: accounts.displayname })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()
  const name = account?.displayname ?? null
  if (name !== null) {
    await cacheSet(cacheKey, name, { ttl: ACCOUNT_CACHE_TTL })
  }
  return name
}

/** Get a full account row by user ID. */
export function getAccount(userId: string): AccountRow | undefined {
  return db.select().from(accounts).where(eq(accounts.id, userId)).get()
}

/** Invalidate cached deactivation status for a user. */
export async function invalidateDeactivatedCache(userId: string): Promise<void> {
  await cacheDel(`m:ad:${userId}`)
}

/** Invalidate cached display name for a user. */
export async function invalidateDisplayNameCache(userId: string): Promise<void> {
  await cacheDel(`m:dn:${userId}`)
}
