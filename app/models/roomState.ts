import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, eventsState } from '@/db/schema'
import { TtlCache } from '@/utils/ttlCache'

const stateContentCache = new TtlCache<Record<string, unknown> | null>(60_000)

/** Read a single state event's content for a room (cached, 60s TTL). */
export function getStateContent(roomId: string, type: string, stateKey = ''): Record<string, unknown> | null {
  const cacheKey = `rs:${roomId}:${type}:${stateKey}`
  const cached = stateContentCache.get(cacheKey)
  if (cached !== undefined)
    return cached

  const row = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, type),
      eq(currentRoomState.stateKey, stateKey),
    ))
    .get()
  if (!row) {
    stateContentCache.set(cacheKey, null)
    return null
  }
  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, row.eventId))
    .get()
  const result = (event?.content as Record<string, unknown>) ?? null
  stateContentCache.set(cacheKey, result)
  return result
}

/** Get power levels content for a room. Returns {} if no power_levels event exists. */
export function getPowerLevelsContent(roomId: string): Record<string, unknown> {
  return getStateContent(roomId, 'm.room.power_levels', '') ?? {}
}

/** Get a user's power level in a room. */
export function getUserPowerLevel(roomId: string, userId: string): number {
  const content = getStateContent(roomId, 'm.room.power_levels', '')
  if (!content)
    return 0

  const usersMap = content.users as Record<string, number> | undefined
  if (usersMap && userId in usersMap) {
    return usersMap[userId]!
  }
  return (content.users_default as number) ?? 0
}

/** Get the required power level for an action (invite, kick, ban, redact, state_default, etc.). */
export function getActionPowerLevel(roomId: string, action: string): number {
  const content = getStateContent(roomId, 'm.room.power_levels', '')
  if (!content)
    return 50

  return (content[action] as number) ?? 50
}

/** Get the join rule for a room. */
export function getJoinRule(roomId: string): string {
  const content = getStateContent(roomId, 'm.room.join_rules', '')
  return (content?.join_rule as string) ?? 'invite'
}

/** Get all current state event IDs for a room (uncached, for full-state dumps). */
export function getAllStateEventIds(roomId: string): string[] {
  return db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(eq(currentRoomState.roomId, roomId))
    .all()
    .map(r => r.eventId)
}

/** Fetch state events by IDs (uncached, for full-state dumps). */
export function getStateEventsByIds(eventIds: string[]): Array<typeof eventsState.$inferSelect> {
  if (eventIds.length === 0)
    return []
  return db.select().from(eventsState).where(inArray(eventsState.id, eventIds)).all()
}

/** Invalidate cached state content for a room. */
export function invalidateStateContent(roomId: string, type?: string, stateKey?: string): void {
  if (type !== undefined && stateKey !== undefined) {
    stateContentCache.invalidate(`rs:${roomId}:${type}:${stateKey}`)
  }
  else {
    stateContentCache.invalidatePrefix(`rs:${roomId}:`)
  }
}
