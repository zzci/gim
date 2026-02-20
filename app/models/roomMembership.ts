import { and, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { roomMembers } from '@/db/schema'
import { TtlCache } from '@/utils/ttlCache'

const membershipCache = new TtlCache<string | null>(60_000)
const memberCountCache = new TtlCache<number>(60_000)

/** Get a user's membership state in a room (cached, 60s TTL). */
export function getMembership(roomId: string, userId: string): string | null {
  const cacheKey = `rm:${roomId}:${userId}`
  const cached = membershipCache.get(cacheKey)
  if (cached !== undefined)
    return cached

  const member = db.select({ membership: roomMembers.membership })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.userId, userId),
    ))
    .get()

  const result = member?.membership ?? null
  membershipCache.set(cacheKey, result)
  return result
}

/** Get the number of joined members in a room (cached, 60s TTL). */
export function getJoinedMemberCount(roomId: string): number {
  const cacheKey = `mc:${roomId}`
  const cached = memberCountCache.get(cacheKey)
  if (cached !== undefined)
    return cached

  const result = db.select({ cnt: count() })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .get()
  const cnt = result?.cnt ?? 0
  memberCountCache.set(cacheKey, cnt)
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
export function invalidateMembership(roomId: string, userId: string): void {
  membershipCache.invalidate(`rm:${roomId}:${userId}`)
}

/** Invalidate cached member count for a room. */
export function invalidateMemberCount(roomId: string): void {
  memberCountCache.invalidate(`mc:${roomId}`)
}
