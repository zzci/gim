import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { rooms } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixError, matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getUserPowerLevel, getRoomMembership } from '@/services/rooms'

export const unbanRoute = new Hono()

unbanRoute.use('/*', authMiddleware)

unbanRoute.post('/', async (c) => {
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

  const membership = getRoomMembership(roomId, targetUserId)
  if (membership !== 'ban') {
    return matrixError(c, 'M_UNKNOWN', 'User is not banned')
  }

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: {
      membership: 'leave',
    },
  })

  return c.json({})
})
