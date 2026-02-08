import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { rooms } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixError, matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership, getUserPowerLevel } from '@/services/rooms'

export const kickRoute = new Hono()

kickRoute.use('/*', authMiddleware)

kickRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const body = await c.req.json()
  const targetUserId = body.user_id
  const reason = body.reason

  if (!targetUserId) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')
  }

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }

  // Check power levels
  const senderPower = getUserPowerLevel(roomId, auth.userId)
  const targetPower = getUserPowerLevel(roomId, targetUserId)
  if (senderPower <= targetPower) {
    return matrixForbidden(c, 'Insufficient power level')
  }

  const content: Record<string, unknown> = { membership: 'leave' }
  if (reason) content.reason = reason

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content,
  })

  return c.json({})
})
