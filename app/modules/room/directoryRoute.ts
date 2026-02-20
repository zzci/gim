import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { roomAliases, rooms } from '@/db/schema'
import { getJoinedMemberCount, getMembership } from '@/models/roomMembership'
import { getActionPowerLevel, getStateContent, getUserPowerLevel } from '@/models/roomState'
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

  const membership = getMembership(roomId, auth.userId)
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
    const name = (getStateContent(room.id, 'm.room.name', '') as Record<string, unknown> | null)?.name as string | undefined
    const topic = (getStateContent(room.id, 'm.room.topic', '') as Record<string, unknown> | null)?.topic as string | undefined
    const avatarUrl = (getStateContent(room.id, 'm.room.avatar', '') as Record<string, unknown> | null)?.url as string | undefined

    // Apply text filter
    if (filter) {
      const lower = filter.toLowerCase()
      if (!name?.toLowerCase().includes(lower) && !topic?.toLowerCase().includes(lower))
        continue
    }

    // Get canonical alias
    const alias = db.select({ alias: roomAliases.alias }).from(roomAliases).where(eq(roomAliases.roomId, room.id)).get()

    // Get member count
    const memberCount = getJoinedMemberCount(room.id)

    // Get join rule
    const joinRuleContent = getStateContent(room.id, 'm.room.join_rules', '')
    const joinRule = (joinRuleContent?.join_rule as string) ?? 'public'

    results.push({
      room_id: room.id,
      name,
      topic,
      avatar_url: avatarUrl,
      canonical_alias: alias?.alias,
      num_joined_members: memberCount,
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
