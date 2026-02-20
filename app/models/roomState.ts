import { and, eq, inArray } from 'drizzle-orm'
import { cacheDel, cacheDelPrefix, cacheGet, cacheSet } from '@/cache'
import { db } from '@/db'
import { currentRoomState, eventsState } from '@/db/schema'

const STATE_CACHE_TTL = 60 // 60 seconds

/** Read a single state event's content for a room (cached, 60s TTL). */
export async function getStateContent(roomId: string, type: string, stateKey = ''): Promise<Record<string, unknown> | null> {
  const cacheKey = `m:rs:${roomId}:${type}:${stateKey}`
  const cached = await cacheGet<Record<string, unknown> | '__null__'>(cacheKey)
  if (cached !== null) {
    return cached === '__null__' ? null : cached
  }

  const row = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, type),
      eq(currentRoomState.stateKey, stateKey),
    ))
    .get()
  if (!row) {
    await cacheSet(cacheKey, '__null__', { ttl: STATE_CACHE_TTL })
    return null
  }
  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, row.eventId))
    .get()
  const result = (event?.content as Record<string, unknown>) ?? null
  await cacheSet(cacheKey, result ?? '__null__', { ttl: STATE_CACHE_TTL })
  return result
}

/** Get power levels content for a room. Returns {} if no power_levels event exists. */
export async function getPowerLevelsContent(roomId: string): Promise<Record<string, unknown>> {
  return await getStateContent(roomId, 'm.room.power_levels', '') ?? {}
}

/** Get a user's power level in a room. */
export async function getUserPowerLevel(roomId: string, userId: string): Promise<number> {
  const content = await getStateContent(roomId, 'm.room.power_levels', '')
  if (!content)
    return 0

  const usersMap = content.users as Record<string, number> | undefined
  if (usersMap && userId in usersMap) {
    return usersMap[userId]!
  }
  return (content.users_default as number) ?? 0
}

/** Get the required power level for an action (invite, kick, ban, redact, state_default, etc.). */
export async function getActionPowerLevel(roomId: string, action: string): Promise<number> {
  const content = await getStateContent(roomId, 'm.room.power_levels', '')
  if (!content)
    return 50

  return (content[action] as number) ?? 50
}

/** Get the join rule for a room. */
export async function getJoinRule(roomId: string): Promise<string> {
  const content = await getStateContent(roomId, 'm.room.join_rules', '')
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
export async function invalidateStateContent(roomId: string, type?: string, stateKey?: string): Promise<void> {
  if (type !== undefined && stateKey !== undefined) {
    await cacheDel(`m:rs:${roomId}:${type}:${stateKey}`)
  }
  else {
    await cacheDelPrefix(`m:rs:${roomId}:`)
  }
}
