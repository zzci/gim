import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { createEvent } from '@/modules/message/service'
import { getRoomId } from '@/modules/message/shared'
import { getRoomMembership } from '@/modules/room/service'
import { matrixForbidden } from '@/shared/middleware/errors'
import { eventContent, validate } from '@/shared/validation'

export function registerSendEventRoute(router: Hono<AuthEnv>) {
  // PUT /rooms/:roomId/send/:eventType/:txnId
  router.put('/:roomId/send/:eventType/:txnId', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const eventType = c.req.param('eventType')
    const txnId = c.req.param('txnId')

    const membership = getRoomMembership(roomId, auth.userId)
    if (membership !== 'join')
      return matrixForbidden(c, 'Not a member of this room')

    const content = await c.req.json()

    const v = validate(c, eventContent, content)
    if (!v.success)
      return v.response

    const event = createEvent({
      roomId,
      sender: auth.userId,
      type: eventType,
      content: v.data,
      unsigned: { transaction_id: txnId },
    })

    return c.json({ event_id: event.event_id })
  })
}
