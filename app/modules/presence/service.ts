import { and, eq, inArray, lt } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import { presence } from '@/db/schema'
import { notifyUser } from '@/modules/sync/notifier'

const UNAVAILABLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const OFFLINE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

function notifyRoommates(userId: string) {
  const roommateIds = sqlite.prepare(`
    SELECT DISTINCT rm2.user_id
    FROM room_members rm1
    JOIN room_members rm2
      ON rm1.room_id = rm2.room_id AND rm2.membership = 'join'
    WHERE rm1.user_id = ? AND rm1.membership = 'join'
      AND rm2.user_id != ?
  `).all(userId, userId) as { user_id: string }[]

  for (const r of roommateIds) {
    notifyUser(r.user_id)
  }
}

export function setPresence(userId: string, state: string, statusMsg?: string) {
  const existing = db.select({ state: presence.state, statusMsg: presence.statusMsg })
    .from(presence)
    .where(eq(presence.userId, userId))
    .get()

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

  if (!existing || existing.state !== state || existing.statusMsg !== (statusMsg ?? null)) {
    notifyRoommates(userId)
  }
}

export function getPresence(userId: string) {
  return db.select().from(presence).where(eq(presence.userId, userId)).get()
}

export function touchPresence(userId: string, state?: string) {
  const existing = db.select().from(presence).where(eq(presence.userId, userId)).get()
  const stateChanged = state && (!existing || existing.state !== state)

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

  if (stateChanged || !existing) {
    notifyRoommates(userId)
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
