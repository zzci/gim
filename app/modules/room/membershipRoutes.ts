import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { maxRoomMembers, maxRoomsPerUser } from '@/config'
import { db } from '@/db'
import { eventsState, roomMembers, rooms } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { checkRoomMemberLimit, checkUserRoomLimit } from '@/modules/room/limits'
import { getRoomJoinRule, getRoomMembership, getUserPowerLevel } from '@/modules/room/service'
import { getRoomId } from '@/modules/room/shared'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { membershipBody, validate } from '@/shared/validation'

// ---- Room membership router (mounted at /_matrix/client/v3/rooms along with message router) ----
export const roomMembershipRouter = new Hono<AuthEnv>()
roomMembershipRouter.use('/*', authMiddleware)

// POST /:roomId/join
roomMembershipRouter.post('/:roomId/join', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return matrixNotFound(c, 'Room not found')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership === 'join')
    return c.json({ room_id: roomId })
  if (membership === 'ban')
    return matrixForbidden(c, 'You are banned')

  const joinRule = getRoomJoinRule(roomId)
  if (joinRule === 'invite' && membership !== 'invite') {
    return matrixForbidden(c, 'You are not invited to this room')
  }

  if (!checkUserRoomLimit(auth.userId)) {
    return matrixError(c, 'M_RESOURCE_LIMIT_EXCEEDED', `You have reached the maximum number of rooms (${maxRoomsPerUser})`)
  }
  if (!checkRoomMemberLimit(roomId)) {
    return matrixError(c, 'M_RESOURCE_LIMIT_EXCEEDED', `This room has reached the maximum number of members (${maxRoomMembers})`)
  }

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: auth.userId,
    content: { membership: 'join' },
  })

  logger.info('room_join', { roomId, userId: auth.userId })
  return c.json({ room_id: roomId })
})

// POST /:roomId/leave
roomMembershipRouter.post('/:roomId/leave', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)

  const membership = getRoomMembership(roomId, auth.userId)
  if (!membership || membership === 'leave' || membership === 'ban') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: auth.userId,
    content: { membership: 'leave' },
  })

  logger.info('room_leave', { roomId, userId: auth.userId })
  return c.json({})
})

// POST /:roomId/invite
roomMembershipRouter.post('/:roomId/invite', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const body = await c.req.json()

  const v = validate(c, membershipBody, body)
  if (!v.success)
    return v.response

  const targetUserId = v.data.user_id

  const senderMembership = getRoomMembership(roomId, auth.userId)
  if (senderMembership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const targetMembership = getRoomMembership(roomId, targetUserId)
  if (targetMembership === 'join')
    return matrixError(c, 'M_UNKNOWN', 'User already in room')
  if (targetMembership === 'ban')
    return matrixForbidden(c, 'User is banned')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: { membership: 'invite' },
  })

  return c.json({})
})

// POST /:roomId/kick
roomMembershipRouter.post('/:roomId/kick', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const body = await c.req.json()

  const vKick = validate(c, membershipBody, body)
  if (!vKick.success)
    return vKick.response

  const senderPower = getUserPowerLevel(roomId, auth.userId)
  const targetPower = getUserPowerLevel(roomId, vKick.data.user_id)
  if (senderPower <= targetPower)
    return matrixForbidden(c, 'Insufficient power level')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: vKick.data.user_id,
    content: { membership: 'leave', ...(vKick.data.reason ? { reason: vKick.data.reason } : {}) },
  })

  logger.info('room_kick', { roomId, userId: auth.userId, targetUserId: vKick.data.user_id })
  return c.json({})
})

// POST /:roomId/ban
roomMembershipRouter.post('/:roomId/ban', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const body = await c.req.json()

  const vBan = validate(c, membershipBody, body)
  if (!vBan.success)
    return vBan.response

  const senderPower = getUserPowerLevel(roomId, auth.userId)
  const targetPower = getUserPowerLevel(roomId, vBan.data.user_id)
  if (senderPower <= targetPower)
    return matrixForbidden(c, 'Insufficient power level')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: vBan.data.user_id,
    content: { membership: 'ban', ...(vBan.data.reason ? { reason: vBan.data.reason } : {}) },
  })

  logger.info('room_ban', { roomId, userId: auth.userId, targetUserId: vBan.data.user_id })
  return c.json({})
})

// POST /:roomId/unban
roomMembershipRouter.post('/:roomId/unban', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const body = await c.req.json()

  if (!body.user_id)
    return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')

  const senderPower = getUserPowerLevel(roomId, auth.userId)
  const targetPower = getUserPowerLevel(roomId, body.user_id)
  if (senderPower <= targetPower)
    return matrixForbidden(c, 'Insufficient power level')

  const membership = getRoomMembership(roomId, body.user_id)
  if (membership !== 'ban')
    return matrixError(c, 'M_UNKNOWN', 'User is not banned')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: body.user_id,
    content: { membership: 'leave' },
  })

  return c.json({})
})

// GET /:roomId/members
roomMembershipRouter.get('/:roomId/members', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const membershipFilter = c.req.query('membership')

  const userMembership = getRoomMembership(roomId, auth.userId)
  if (userMembership !== 'join' && userMembership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const rows = db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId)).all()
  const filtered = membershipFilter ? rows.filter(r => r.membership === membershipFilter) : rows

  const memberEvents = []
  for (const row of filtered) {
    const event = db.select().from(eventsState).where(eq(eventsState.id, row.eventId)).get()
    if (event) {
      memberEvents.push({
        event_id: `$${event.id}`,
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
