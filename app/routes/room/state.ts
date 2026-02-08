import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, events, rooms } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership, getUserPowerLevel } from '@/services/rooms'

export const stateRoute = new Hono()

stateRoute.use('/*', authMiddleware)

// GET /rooms/:roomId/state - get all current state
stateRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const stateRows = db.select({
    eventId: currentRoomState.eventId,
    type: currentRoomState.type,
    stateKey: currentRoomState.stateKey,
  })
    .from(currentRoomState)
    .where(eq(currentRoomState.roomId, roomId))
    .all()

  const eventIds = stateRows.map(r => r.eventId)
  if (eventIds.length === 0) return c.json([])

  const stateEvents = db.select()
    .from(events)
    .where(eq(events.roomId, roomId))
    .all()
    .filter(e => eventIds.includes(e.id))

  const result = stateEvents.map(e => ({
    event_id: e.id,
    room_id: e.roomId,
    sender: e.sender,
    type: e.type,
    state_key: e.stateKey ?? '',
    content: e.content,
    origin_server_ts: e.originServerTs,
  }))

  return c.json(result)
})

// GET /rooms/:roomId/state/:eventType/:stateKey?
stateRoute.get('/:eventType/:stateKey?', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, eventType),
      eq(currentRoomState.stateKey, stateKey),
    ))
    .get()

  if (!stateRow) {
    return matrixNotFound(c, 'State event not found')
  }

  const event = db.select({ content: events.content })
    .from(events)
    .where(eq(events.id, stateRow.eventId))
    .get()

  return c.json(event?.content ?? {})
})

// PUT /rooms/:roomId/state/:eventType/:stateKey?
stateRoute.put('/:eventType/:stateKey?', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const content = await c.req.json()

  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: eventType,
    stateKey,
    content,
  })

  return c.json({ event_id: event.event_id })
})
