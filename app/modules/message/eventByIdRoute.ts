import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { getRoomId } from '@/modules/message/shared'
import { getRoomMembership } from '@/modules/room/service'
import { parseEventId, queryEventById } from '@/shared/helpers/eventQueries'
import { formatEventWithRelations } from '@/shared/helpers/formatEvent'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

export function registerEventByIdRoute(router: Hono<AuthEnv>) {
  // GET /rooms/:roomId/event/:eventId
  router.get('/:roomId/event/:eventId', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const eventId = parseEventId(c.req.param('eventId'))

    const membership = await getRoomMembership(roomId, auth.userId)
    if (membership !== 'join' && membership !== 'invite') {
      return matrixForbidden(c, 'Not a member of this room')
    }

    const event = queryEventById(eventId)
    if (!event || event.roomId !== roomId)
      return matrixNotFound(c, 'Event not found')

    return c.json(formatEventWithRelations(event))
  })
}
