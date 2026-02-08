import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { rooms } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixError, matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership, getUserPowerLevel } from '@/services/rooms'

export const inviteRoute = new Hono()

inviteRoute.use('/*', authMiddleware)

// POST /rooms/:roomId/invite
inviteRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const body = await c.req.json()
  const targetUserId = body.user_id

  if (!targetUserId) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')
  }

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }

  // Check sender is a member
  const senderMembership = getRoomMembership(roomId, auth.userId)
  if (senderMembership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  // Check target is not already joined or banned
  const targetMembership = getRoomMembership(roomId, targetUserId)
  if (targetMembership === 'join') {
    return matrixError(c, 'M_UNKNOWN', 'User is already in the room')
  }
  if (targetMembership === 'ban') {
    return matrixForbidden(c, 'User is banned from this room')
  }

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: {
      membership: 'invite',
    },
  })

  return c.json({})
})
