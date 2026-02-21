import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { maxRoomMembers, maxRoomsPerUser } from '@/config'
import { db } from '@/db'
import { eventsState, roomAliases, roomMembers, rooms } from '@/db/schema'
import { getActionPowerLevel, getJoinRule, getUserPowerLevel } from '@/models/roomState'
import { createEvent } from '@/modules/message/service'
import { checkRoomMemberLimit, checkUserRoomLimit } from '@/modules/room/limits'
import { getRoomMembership } from '@/modules/room/service'
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

  const membership = await getRoomMembership(roomId, auth.userId)
  if (membership === 'join')
    return c.json({ room_id: roomId })
  if (membership === 'ban')
    return matrixForbidden(c, 'You are banned')

  const joinRule = await getJoinRule(roomId)
  if (joinRule === 'invite' && membership !== 'invite') {
    return matrixForbidden(c, 'You are not invited to this room')
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

// POST /:roomId/leave
roomMembershipRouter.post('/:roomId/leave', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)

  const membership = await getRoomMembership(roomId, auth.userId)
  if (!membership || membership === 'leave' || membership === 'ban') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  await createEvent({
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

  const senderMembership = await getRoomMembership(roomId, auth.userId)
  if (senderMembership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const senderPower = await getUserPowerLevel(roomId, auth.userId)
  const invitePower = await getActionPowerLevel(roomId, 'invite')
  if (senderPower < invitePower)
    return matrixForbidden(c, 'Insufficient power level to invite')

  const targetMembership = await getRoomMembership(roomId, targetUserId)
  if (targetMembership === 'join')
    return matrixError(c, 'M_UNKNOWN', 'User already in room')
  if (targetMembership === 'ban')
    return matrixForbidden(c, 'User is banned')

  await createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: {
      membership: 'invite',
      ...(v.data.is_direct ? { is_direct: true } : {}),
    },
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

  const senderPower = await getUserPowerLevel(roomId, auth.userId)
  const kickThreshold = await getActionPowerLevel(roomId, 'kick')
  if (senderPower < kickThreshold)
    return matrixForbidden(c, 'Insufficient power level to kick')
  const targetPower = await getUserPowerLevel(roomId, vKick.data.user_id)
  if (senderPower <= targetPower)
    return matrixForbidden(c, 'Cannot kick user with equal or higher power level')

  await createEvent({
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

  const senderPower = await getUserPowerLevel(roomId, auth.userId)
  const banThreshold = await getActionPowerLevel(roomId, 'ban')
  if (senderPower < banThreshold)
    return matrixForbidden(c, 'Insufficient power level to ban')
  const targetPower = await getUserPowerLevel(roomId, vBan.data.user_id)
  if (senderPower <= targetPower)
    return matrixForbidden(c, 'Cannot ban user with equal or higher power level')

  await createEvent({
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

  const vUnban = validate(c, membershipBody, body)
  if (!vUnban.success)
    return vUnban.response

  const senderMembership = await getRoomMembership(roomId, auth.userId)
  if (senderMembership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const senderPower = await getUserPowerLevel(roomId, auth.userId)
  const banThreshold = await getActionPowerLevel(roomId, 'ban')
  if (senderPower < banThreshold)
    return matrixForbidden(c, 'Insufficient power level to unban')
  const targetPower = await getUserPowerLevel(roomId, vUnban.data.user_id)
  if (senderPower <= targetPower)
    return matrixForbidden(c, 'Cannot unban user with equal or higher power level')

  const membership = await getRoomMembership(roomId, vUnban.data.user_id)
  if (membership !== 'ban')
    return matrixError(c, 'M_UNKNOWN', 'User is not banned')

  await createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: vUnban.data.user_id,
    content: { membership: 'leave' },
  })

  return c.json({})
})

// GET /:roomId/members
roomMembershipRouter.get('/:roomId/members', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const membershipFilter = c.req.query('membership')

  const userMembership = await getRoomMembership(roomId, auth.userId)
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

// GET /:roomId/aliases — List room aliases
roomMembershipRouter.get('/:roomId/aliases', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)

  const membership = await getRoomMembership(roomId, auth.userId)
  if (membership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const aliases = db.select({ alias: roomAliases.alias })
    .from(roomAliases)
    .where(eq(roomAliases.roomId, roomId))
    .all()

  return c.json({ aliases: aliases.map(a => a.alias) })
})
