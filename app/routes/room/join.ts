import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { rooms, roomAliases } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixError, matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership, getRoomJoinRule } from '@/services/rooms'

export const joinRoute = new Hono()

joinRoute.use('/*', authMiddleware)

// POST /join/:roomIdOrAlias
joinRoute.post('/:roomIdOrAlias', async (c) => {
  const auth = c.get('auth') as AuthContext
  let roomIdOrAlias = decodeURIComponent(c.req.param('roomIdOrAlias'))

  // Resolve alias to room ID
  let roomId = roomIdOrAlias
  if (roomIdOrAlias.startsWith('#')) {
    const alias = await db.select().from(roomAliases)
      .where(eq(roomAliases.alias, roomIdOrAlias))
      .limit(1)
    if (!alias[0]) {
      return matrixNotFound(c, 'Room alias not found')
    }
    roomId = alias[0].roomId
  }

  // Check room exists
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }

  // Check current membership
  const membership = getRoomMembership(roomId, auth.userId)
  if (membership === 'join') {
    return c.json({ room_id: roomId })
  }

  // Check join rules
  const joinRule = getRoomJoinRule(roomId)
  if (joinRule === 'invite' && membership !== 'invite') {
    return matrixForbidden(c, 'You are not invited to this room')
  }
  if (membership === 'ban') {
    return matrixForbidden(c, 'You are banned from this room')
  }

  // Create join event
  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: auth.userId,
    content: {
      membership: 'join',
    },
  })

  return c.json({ room_id: roomId })
})
