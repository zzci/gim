import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { events } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership } from '@/services/rooms'

export const redactRoute = new Hono()

redactRoute.use('/*', authMiddleware)

// PUT /rooms/:roomId/redact/:eventId/:txnId
redactRoute.put('/:eventId/:txnId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const targetEventId = c.req.param('eventId')
  const txnId = c.req.param('txnId')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const targetEvent = db.select().from(events).where(eq(events.id, targetEventId)).get()
  if (!targetEvent || targetEvent.roomId !== roomId) {
    return matrixNotFound(c, 'Event not found')
  }

  const body = await c.req.json().catch(() => ({}))

  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.redaction',
    content: {
      redacts: targetEventId,
      ...(body.reason ? { reason: body.reason } : {}),
    },
    unsigned: { transaction_id: txnId },
  })

  // Strip the original event content
  db.update(events)
    .set({ content: {} })
    .where(eq(events.id, targetEventId))
    .run()

  return c.json({ event_id: event.event_id })
})
