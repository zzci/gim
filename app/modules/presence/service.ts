import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/db'
import { presence, roomMembers } from '@/db/schema'

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
  // Get all rooms the user is in
  const userRooms = db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.userId, userId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()

  if (userRooms.length === 0)
    return []

  // Get all unique members from those rooms
  const roommateIds = new Set<string>()
  for (const room of userRooms) {
    const members = db.select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(and(
        eq(roomMembers.roomId, room.roomId),
        eq(roomMembers.membership, 'join'),
      ))
      .all()
    for (const m of members) {
      if (m.userId !== userId)
        roommateIds.add(m.userId)
    }
  }

  if (roommateIds.size === 0)
    return []

  return db.select().from(presence).where(inArray(presence.userId, [...roommateIds])).all()
}
