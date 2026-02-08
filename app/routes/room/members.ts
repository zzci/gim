import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { roomMembers, events } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixForbidden } from '@/middleware/errors'
import { getRoomMembership } from '@/services/rooms'

export const membersRoute = new Hono()

membersRoute.use('/*', authMiddleware)

// GET /rooms/:roomId/members
membersRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const membership = c.req.query('membership')

  const userMembership = getRoomMembership(roomId, auth.userId)
  if (userMembership !== 'join' && userMembership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  let query = db.select({
    eventId: roomMembers.eventId,
    userId: roomMembers.userId,
    membershipVal: roomMembers.membership,
  })
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId))

  const rows = query.all()

  // Filter by membership if specified
  const filtered = membership
    ? rows.filter(r => r.membershipVal === membership)
    : rows

  // Get the full events
  const memberEvents = []
  for (const row of filtered) {
    const event = db.select().from(events).where(eq(events.id, row.eventId)).get()
    if (event) {
      memberEvents.push({
        event_id: event.id,
        room_id: event.roomId,
        sender: event.sender,
        type: event.type,
        state_key: event.stateKey ?? '',
        content: event.content,
        origin_server_ts: event.originServerTs,
      })
    }
  }

  return c.json({ chunk: memberEvents })
})
