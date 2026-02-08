import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { events } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { getRoomMembership } from '@/services/rooms'

export const eventRoute = new Hono()

eventRoute.use('/*', authMiddleware)

// GET /rooms/:roomId/event/:eventId
eventRoute.get('/:eventId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const eventId = c.req.param('eventId')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const event = db.select().from(events).where(eq(events.id, eventId)).get()
  if (!event || event.roomId !== roomId) {
    return matrixNotFound(c, 'Event not found')
  }

  return c.json({
    event_id: event.id,
    room_id: event.roomId,
    sender: event.sender,
    type: event.type,
    content: event.content,
    origin_server_ts: event.originServerTs,
    ...(event.stateKey !== null ? { state_key: event.stateKey } : {}),
  })
})
