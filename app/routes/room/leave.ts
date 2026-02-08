import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { rooms } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership } from '@/services/rooms'

export const leaveRoute = new Hono()

leaveRoute.use('/*', authMiddleware)

// POST /rooms/:roomId/leave
leaveRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }

  const membership = getRoomMembership(roomId, auth.userId)
  if (!membership || membership === 'leave' || membership === 'ban') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: auth.userId,
    content: {
      membership: 'leave',
    },
  })

  return c.json({})
})
