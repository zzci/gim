import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accounts } from '@/db/schema'
import { TtlCache } from '@/utils/ttlCache'

const ACCOUNT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const deactivatedCache = new TtlCache<boolean>(ACCOUNT_CACHE_TTL)
const displayNameCache = new TtlCache<string | null>(ACCOUNT_CACHE_TTL)

export type AccountRow = typeof accounts.$inferSelect

/** Check if an account is deactivated (cached, 5min TTL). */
export function isDeactivated(userId: string): boolean {
  const cached = deactivatedCache.get(userId)
  if (cached !== undefined)
    return cached

  const account = db.select({ isDeactivated: accounts.isDeactivated })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()
  const result = !!account?.isDeactivated
  deactivatedCache.set(userId, result)
  return result
}

/** Get a user's display name (cached, 5min TTL). */
export function getDisplayName(userId: string): string | null {
  const cached = displayNameCache.get(userId)
  if (cached !== undefined)
    return cached

  const account = db.select({ displayname: accounts.displayname })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()
  const name = account?.displayname ?? null
  displayNameCache.set(userId, name)
  return name
}

/** Get a full account row by user ID. */
export function getAccount(userId: string): AccountRow | undefined {
  return db.select().from(accounts).where(eq(accounts.id, userId)).get()
}

/** Invalidate cached deactivation status for a user. */
export function invalidateDeactivatedCache(userId: string): void {
  deactivatedCache.invalidate(userId)
}

/** Invalidate cached display name for a user. */
export function invalidateDisplayNameCache(userId: string): void {
  displayNameCache.invalidate(userId)
}
