import type { Hono } from 'hono'
import { count, eq, like, sql } from 'drizzle-orm'
import { db } from '@/db'
import { roomMembers, rooms } from '@/db/schema'
import { getAllStateEventIds, getStateEventsByIds } from '@/models/roomState'
import { createEvent } from '@/modules/message/service'
import { getAdminContext, logAdminAction } from './helpers'

export function registerAdminRoomsRoutes(adminRoute: Hono) {
  // GET /api/rooms — Paginated room list
  adminRoute.get('/api/rooms', (c) => {
    const limit = Number(c.req.query('limit') || 50)
    const offset = Number(c.req.query('offset') || 0)
    const search = c.req.query('search')

    // Use prefix match for !room:server format (can use primary key index)
    const where = search
      ? like(rooms.id, search.startsWith('!') ? `${search}%` : `%${search}%`)
      : undefined

    const rows = db
      .select({
        id: rooms.id,
        version: rooms.version,
        creatorId: rooms.creatorId,
        isDirect: rooms.isDirect,
        createdAt: rooms.createdAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM room_members WHERE room_id = ${rooms.id} AND membership = 'join')`,
      })
      .from(rooms)
      .where(where)
      .limit(limit)
      .offset(offset)
      .all()

    const total = db.select({ count: count() }).from(rooms).where(where).get()!

    return c.json({ rooms: rows, total: total.count })
  })

  // GET /api/rooms/:roomId — Room details
  adminRoute.get('/api/rooms/:roomId', (c) => {
    const roomId = c.req.param('roomId')

    const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
    if (!room)
      return c.json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404)

    const members = db
      .select({
        userId: roomMembers.userId,
        membership: roomMembers.membership,
      })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, roomId))
      .all()

    return c.json({ room, members })
  })

  // GET /api/rooms/:roomId/state — Room state viewer
  adminRoute.get('/api/rooms/:roomId/state', (c) => {
    const roomId = c.req.param('roomId')

    const room = db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).get()
    if (!room)
      return c.json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404)

    const eventIds = getAllStateEventIds(roomId)
    if (eventIds.length === 0)
      return c.json([])

    const events = getStateEventsByIds(eventIds)
    return c.json(events.map(event => ({
      type: event.type,
      state_key: event.stateKey,
      sender: event.sender,
      content: event.content,
      event_id: `$${event.id}`,
      origin_server_ts: event.originServerTs,
    })))
  })

  // PUT /api/rooms/:roomId/state/:eventType/:stateKey — Room state editor
  adminRoute.put('/api/rooms/:roomId/state/:eventType/:stateKey', async (c) => {
    const roomId = c.req.param('roomId')
    const eventType = c.req.param('eventType')
    const stateKey = c.req.param('stateKey') ?? ''

    const room = db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).get()
    if (!room)
      return c.json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404)

    const { adminUserId, ip } = getAdminContext(c)
    const body = await c.req.json<{ content: Record<string, unknown> }>()

    const event = createEvent({
      roomId,
      sender: adminUserId,
      type: eventType,
      stateKey,
      content: body.content,
    })

    logAdminAction(adminUserId, 'room.set_state', 'room', roomId, { eventType, stateKey }, ip)

    return c.json({ event_id: event.event_id })
  })
}
