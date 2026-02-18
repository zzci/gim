import type { AuthEnv } from '@/shared/middleware/auth'
import { and, count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { currentRoomState, eventsState, roomAliases, roomMembers, rooms } from '@/db/schema'
import { getActionPowerLevel, getRoomMembership, getUserPowerLevel } from '@/modules/room/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

// ---- Room Directory Visibility ----
export const directoryListRoute = new Hono<AuthEnv>()

// GET /:roomId — Get room visibility in directory
directoryListRoute.get('/:roomId', (c) => {
  const roomId = decodeURIComponent(c.req.param('roomId'))

  const room = db.select({ visibility: rooms.visibility }).from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return matrixNotFound(c, 'Room not found')

  return c.json({ visibility: room.visibility })
})

// PUT /:roomId — Set room visibility in directory (requires auth + power level)
directoryListRoute.put('/:roomId', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const roomId = decodeURIComponent(c.req.param('roomId'))
  const body = await c.req.json<{ visibility?: string }>()

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return matrixNotFound(c, 'Room not found')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const userPower = getUserPowerLevel(roomId, auth.userId)
  const requiredPower = getActionPowerLevel(roomId, 'state_default')
  if (userPower < requiredPower)
    return matrixForbidden(c, 'Insufficient power level')

  const visibility = body.visibility === 'public' ? 'public' : 'private'
  db.update(rooms).set({ visibility }).where(eq(rooms.id, roomId)).run()

  return c.json({})
})

// ---- Public Room Directory ----
export const publicRoomsRoute = new Hono<AuthEnv>()

function getPublicRooms(limit: number, since: number, filter?: string) {
  const allPublic = db.select().from(rooms).where(eq(rooms.visibility, 'public')).all()

  const results = []
  for (const room of allPublic) {
    // Get room name
    const nameRow = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(and(eq(currentRoomState.roomId, room.id), eq(currentRoomState.type, 'm.room.name'), eq(currentRoomState.stateKey, '')))
      .get()
    let name: string | undefined
    if (nameRow) {
      const event = db.select({ content: eventsState.content }).from(eventsState).where(eq(eventsState.id, nameRow.eventId)).get()
      name = (event?.content as any)?.name
    }

    // Get room topic
    const topicRow = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(and(eq(currentRoomState.roomId, room.id), eq(currentRoomState.type, 'm.room.topic'), eq(currentRoomState.stateKey, '')))
      .get()
    let topic: string | undefined
    if (topicRow) {
      const event = db.select({ content: eventsState.content }).from(eventsState).where(eq(eventsState.id, topicRow.eventId)).get()
      topic = (event?.content as any)?.topic
    }

    // Get room avatar
    const avatarRow = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(and(eq(currentRoomState.roomId, room.id), eq(currentRoomState.type, 'm.room.avatar'), eq(currentRoomState.stateKey, '')))
      .get()
    let avatarUrl: string | undefined
    if (avatarRow) {
      const event = db.select({ content: eventsState.content }).from(eventsState).where(eq(eventsState.id, avatarRow.eventId)).get()
      avatarUrl = (event?.content as any)?.url
    }

    // Apply text filter
    if (filter) {
      const lower = filter.toLowerCase()
      if (!name?.toLowerCase().includes(lower) && !topic?.toLowerCase().includes(lower))
        continue
    }

    // Get canonical alias
    const alias = db.select({ alias: roomAliases.alias }).from(roomAliases).where(eq(roomAliases.roomId, room.id)).get()

    // Get member count
    const memberCount = db.select({ cnt: count() }).from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.membership, 'join'))).get()

    // Get join rule
    const joinRuleRow = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(and(eq(currentRoomState.roomId, room.id), eq(currentRoomState.type, 'm.room.join_rules'), eq(currentRoomState.stateKey, '')))
      .get()
    let joinRule = 'public'
    if (joinRuleRow) {
      const event = db.select({ content: eventsState.content }).from(eventsState).where(eq(eventsState.id, joinRuleRow.eventId)).get()
      joinRule = (event?.content as any)?.join_rule ?? 'public'
    }

    results.push({
      room_id: room.id,
      name,
      topic,
      avatar_url: avatarUrl,
      canonical_alias: alias?.alias,
      num_joined_members: memberCount?.cnt ?? 0,
      world_readable: false,
      guest_can_join: false,
      join_rule: joinRule,
    })
  }

  // Paginate
  const paginated = results.slice(since, since + limit)
  const nextBatch = since + paginated.length < results.length ? String(since + paginated.length) : undefined

  return {
    chunk: paginated,
    total_room_count_estimate: results.length,
    ...(nextBatch ? { next_batch: nextBatch } : {}),
  }
}

// GET / — List public rooms
publicRoomsRoute.get('/', (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 20), 1), 100)
  const since = Math.max(Number(c.req.query('since') || 0), 0)

  return c.json(getPublicRooms(limit, since))
})

// POST / — Search public rooms
publicRoomsRoute.post('/', async (c) => {
  const body = await c.req.json<{ limit?: number, since?: string, filter?: { generic_search_term?: string } }>()
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 100)
  const since = Math.max(Number(body.since || 0), 0)
  const filter = body.filter?.generic_search_term

  return c.json(getPublicRooms(limit, since, filter))
})
