import { and, count, eq } from 'drizzle-orm'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { db } from '@/db'
import { roomMembers } from '@/db/schema'

const MEMBERSHIP_CACHE_TTL = 60 // 60 seconds
const MEMBER_COUNT_CACHE_TTL = 60 // 60 seconds

/** Get a user's membership state in a room (cached, 60s TTL). */
export async function getMembership(roomId: string, userId: string): Promise<string | null> {
  const cacheKey = `m:rm:${roomId}:${userId}`
  const cached = await cacheGet<string>(cacheKey)
  if (cached !== null)
    return cached

  const member = db.select({ membership: roomMembers.membership })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.userId, userId),
    ))
    .get()

  const result = member?.membership ?? null
  if (result !== null) {
    await cacheSet(cacheKey, result, { ttl: MEMBERSHIP_CACHE_TTL })
  }
  return result
}

/** Get the number of joined members in a room (cached, 60s TTL). */
export async function getJoinedMemberCount(roomId: string): Promise<number> {
  const cacheKey = `m:mc:${roomId}`
  const cached = await cacheGet<number>(cacheKey)
  if (cached !== null)
    return cached

  const result = db.select({ cnt: count() })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .get()
  const cnt = result?.cnt ?? 0
  await cacheSet(cacheKey, cnt, { ttl: MEMBER_COUNT_CACHE_TTL })
  return cnt
}

/** Get all joined member user IDs in a room (uncached). */
export function getJoinedMembers(roomId: string): string[] {
  return db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()
    .map(r => r.userId)
}

/** Get all room IDs a user has joined (uncached). */
export function getJoinedRoomIds(userId: string): string[] {
  return db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.userId, userId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()
    .map(r => r.roomId)
}

/** Invalidate cached membership for a specific user in a room. */
export async function invalidateMembership(roomId: string, userId: string): Promise<void> {
  await cacheDel(`m:rm:${roomId}:${userId}`)
}

/** Invalidate cached member count for a room. */
export async function invalidateMemberCount(roomId: string): Promise<void> {
  await cacheDel(`m:mc:${roomId}`)
}
