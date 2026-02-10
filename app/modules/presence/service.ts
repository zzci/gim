import { and, eq, inArray, lt } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import { presence } from '@/db/schema'

const UNAVAILABLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const OFFLINE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

export function setPresence(userId: string, state: string, statusMsg?: string) {
  db.insert(presence).values({
    userId,
    state,
    statusMsg: statusMsg ?? null,
    lastActiveAt: new Date(),
  }).onConflictDoUpdate({
    target: [presence.userId],
    set: {
      state,
      statusMsg: statusMsg ?? null,
      lastActiveAt: new Date(),
    },
  }).run()
}

export function getPresence(userId: string) {
  return db.select().from(presence).where(eq(presence.userId, userId)).get()
}

export function touchPresence(userId: string, state?: string) {
  const existing = db.select().from(presence).where(eq(presence.userId, userId)).get()
  if (existing) {
    db.update(presence).set({
      lastActiveAt: new Date(),
      ...(state ? { state } : {}),
    }).where(eq(presence.userId, userId)).run()
  }
  else {
    db.insert(presence).values({
      userId,
      state: state || 'online',
      lastActiveAt: new Date(),
    }).run()
  }
}

export function expirePresence() {
  const now = Date.now()

  // online → unavailable after 5 min
  db.update(presence)
    .set({ state: 'unavailable' })
    .where(and(
      eq(presence.state, 'online'),
      lt(presence.lastActiveAt, new Date(now - UNAVAILABLE_TIMEOUT_MS)),
    ))
    .run()

  // unavailable → offline after 15 min
  db.update(presence)
    .set({ state: 'offline' })
    .where(and(
      eq(presence.state, 'unavailable'),
      lt(presence.lastActiveAt, new Date(now - OFFLINE_TIMEOUT_MS)),
    ))
    .run()
}

export function getPresenceForRoommates(userId: string) {
  // Single query: get all unique roommate user IDs via subquery join
  // Replaces N+1 pattern of querying members per room
  const roommateIds = sqlite.prepare(`
    SELECT DISTINCT rm2.user_id
    FROM room_members rm1
    JOIN room_members rm2
      ON rm1.room_id = rm2.room_id AND rm2.membership = 'join'
    WHERE rm1.user_id = ? AND rm1.membership = 'join'
      AND rm2.user_id != ?
  `).all(userId, userId) as { user_id: string }[]

  if (roommateIds.length === 0)
    return []

  const ids = roommateIds.map(r => r.user_id)
  return db.select().from(presence).where(inArray(presence.userId, ids)).all()
}
