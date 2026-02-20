import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { maxRoomMembers, maxRoomsPerUser } from '@/config'
import { db } from '@/db'
import { roomAliases, rooms } from '@/db/schema'
import { getJoinRule } from '@/models/roomState'
import { queryAppServiceRoomAlias } from '@/modules/appservice/service'
import { createEvent } from '@/modules/message/service'
import { checkRoomMemberLimit, checkUserRoomLimit } from '@/modules/room/limits'
import { getRoomMembership } from '@/modules/room/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

// POST /:roomIdOrAlias — mounted at /_matrix/client/v3/join
export const joinRoute = new Hono<AuthEnv>()
joinRoute.use('/*', authMiddleware)

joinRoute.post('/:roomIdOrAlias', async (c) => {
  const auth = c.get('auth')
  const roomIdOrAlias = decodeURIComponent(c.req.param('roomIdOrAlias'))
  let roomId = roomIdOrAlias
  if (roomIdOrAlias.startsWith('#')) {
    let alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomIdOrAlias)).get()
    if (!alias) {
      // Fallback: query application services
      const asRoomId = await queryAppServiceRoomAlias(roomIdOrAlias)
      if (asRoomId) {
        alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomIdOrAlias)).get()
      }
      if (!alias) {
        return matrixNotFound(c, 'Room alias not found')
      }
    }
    roomId = alias.roomId
  }
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }
  const membership = await getRoomMembership(roomId, auth.userId)
  if (membership === 'join') {
    return c.json({ room_id: roomId })
  }
  const joinRule = await getJoinRule(roomId)
  if (joinRule === 'invite' && membership !== 'invite') {
    return matrixForbidden(c, 'You are not invited to this room')
  }
  if (membership === 'ban') {
    return matrixForbidden(c, 'You are banned from this room')
  }
  if (!await checkUserRoomLimit(auth.userId)) {
    return matrixError(c, 'M_RESOURCE_LIMIT_EXCEEDED', `You have reached the maximum number of rooms (${maxRoomsPerUser})`)
  }
  if (!await checkRoomMemberLimit(roomId)) {
    return matrixError(c, 'M_RESOURCE_LIMIT_EXCEEDED', `This room has reached the maximum number of members (${maxRoomMembers})`)
  }
  await createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: auth.userId,
    content: { membership: 'join' },
  })
  logger.info('room_join', { roomId, userId: auth.userId })
  return c.json({ room_id: roomId })
})
