import { Hono } from 'hono'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership } from '@/services/rooms'

export const sendRoute = new Hono()

sendRoute.use('/*', authMiddleware)

// PUT /rooms/:roomId/send/:eventType/:txnId
sendRoute.put('/:eventType/:txnId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const eventType = c.req.param('eventType')
  const txnId = c.req.param('txnId')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const content = await c.req.json()

  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: eventType,
    content,
    unsigned: { transaction_id: txnId },
  })

  return c.json({ event_id: event.event_id })
})
