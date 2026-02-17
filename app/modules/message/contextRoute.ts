import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, eventsState } from '@/db/schema'
import { getRoomId } from '@/modules/message/shared'
import { getRoomMembership } from '@/modules/room/service'
import { parseEventId, queryEventById, queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEvent, formatEventListWithRelations, formatEventWithRelations } from '@/shared/helpers/formatEvent'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

export function registerContextRoute(router: Hono<AuthEnv>) {
  // GET /rooms/:roomId/context/:eventId
  router.get('/:roomId/context/:eventId', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const eventId = parseEventId(c.req.param('eventId'))

    const membership = getRoomMembership(roomId, auth.userId)
    if (membership !== 'join' && membership !== 'invite') {
      return matrixForbidden(c, 'Not a member of this room')
    }

    const target = queryEventById(eventId)
    if (!target || target.roomId !== roomId)
      return matrixNotFound(c, 'Event not found')

    const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') || '10'), 0), 100)
    const half = Math.floor(limit / 2)

    const eventsBefore = queryRoomEvents(roomId, { before: target.id, order: 'desc', limit: half })
    const eventsAfter = queryRoomEvents(roomId, { after: target.id, order: 'asc', limit: half })

    // Get current room state
    const stateRows = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(eq(currentRoomState.roomId, roomId))
      .all()

    const { inArray } = await import('drizzle-orm')
    const stateEventIds = stateRows.map(r => r.eventId)
    const currentState = stateEventIds.length > 0
      ? db.select().from(eventsState).where(inArray(eventsState.id, stateEventIds)).all()
      : []

    const start = eventsBefore.length > 0 ? eventsBefore[eventsBefore.length - 1]!.id : target.id
    const end = eventsAfter.length > 0 ? eventsAfter[eventsAfter.length - 1]!.id : target.id

    return c.json({
      event: formatEventWithRelations(target),
      events_before: formatEventListWithRelations(eventsBefore),
      events_after: formatEventListWithRelations(eventsAfter),
      start,
      end,
      state: currentState.map(formatEvent),
    })
  })
}
