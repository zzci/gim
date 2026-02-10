import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { maxRoomMembers, maxRoomsPerUser, serverName } from '@/config'
import { db } from '@/db'
import { accountTokens, eventsState, oauthTokens, roomAliases, roomMembers, rooms } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { createRoom, getRoomJoinRule, getRoomMembership, getRoomSummary, getUserPowerLevel } from '@/modules/room/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { createRoomBody, membershipBody, validate } from '@/shared/validation'

function checkUserRoomLimit(userId: string): boolean {
  if (maxRoomsPerUser <= 0)
    return true
  const count = db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.userId, userId), eq(roomMembers.membership, 'join')))
    .all()
    .length
  return count < maxRoomsPerUser
}

function checkRoomMemberLimit(roomId: string): boolean {
  if (maxRoomMembers <= 0)
    return true
  const count = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.membership, 'join')))
    .all()
    .length
  return count < maxRoomMembers
}

// ---- Top-level room routes (each mounted at a different base path) ----

// POST / — mounted at /_matrix/client/v3/createRoom
export const createRoomRoute = new Hono<AuthEnv>()
createRoomRoute.use('/*', authMiddleware)

createRoomRoute.post('/', async (c) => {
  const auth = c.get('auth')
  if (!checkUserRoomLimit(auth.userId)) {
    return matrixError(c, 'M_RESOURCE_LIMIT_EXCEEDED', `You have reached the maximum number of rooms (${maxRoomsPerUser})`)
  }
  const body = await c.req.json()

  const v = validate(c, createRoomBody, body)
  if (!v.success)
    return v.response

  const roomId = createRoom({
    creatorId: auth.userId,
    name: body.name,
    topic: body.topic,
    roomAliasName: body.room_alias_name,
    visibility: body.visibility,
    preset: body.preset,
    isDirect: body.is_direct,
    invite: body.invite,
    initialState: body.initial_state,
    powerLevelContentOverride: body.power_level_content_override,
  })
  return c.json({ room_id: roomId })
})

// POST /:roomIdOrAlias — mounted at /_matrix/client/v3/join
export const joinRoute = new Hono<AuthEnv>()
joinRoute.use('/*', authMiddleware)

joinRoute.post('/:roomIdOrAlias', async (c) => {
  const auth = c.get('auth')
  const roomIdOrAlias = decodeURIComponent(c.req.param('roomIdOrAlias'))
  let roomId = roomIdOrAlias
  if (roomIdOrAlias.startsWith('#')) {
    const alias = await db.select().from(roomAliases).where(eq(roomAliases.alias, roomIdOrAlias)).limit(1)
    if (!alias[0]) {
      return matrixNotFound(c, 'Room alias not found')
    }
    roomId = alias[0].roomId
  }
  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }
  const membership = getRoomMembership(roomId, auth.userId)
  if (membership === 'join') {
    return c.json({ room_id: roomId })
  }
  const joinRule = getRoomJoinRule(roomId)
  if (joinRule === 'invite' && membership !== 'invite') {
    return matrixForbidden(c, 'You are not invited to this room')
  }
  if (membership === 'ban') {
    return matrixForbidden(c, 'You are banned from this room')
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

// GET / — mounted at /_matrix/client/v3/joined_rooms
export const joinedRoomsRoute = new Hono<AuthEnv>()
joinedRoomsRoute.use('/*', authMiddleware)

joinedRoomsRoute.get('/', async (c) => {
  const auth = c.get('auth')
  const rows = db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.userId, auth.userId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()
  return c.json({ joined_rooms: rows.map(r => r.roomId) })
})

// ---- Room membership router (mounted at /_matrix/client/v3/rooms along with message router) ----

export const roomMembershipRouter = new Hono<AuthEnv>()
roomMembershipRouter.use('/*', authMiddleware)

// Helper to extract roomId from the path
function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

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

// ---- Room Alias CRUD ----

export const roomAliasRoute = new Hono<AuthEnv>()

// PUT /:roomAlias — Create alias (requires auth)
roomAliasRoute.put('/:roomAlias', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const roomAlias = decodeURIComponent(c.req.param('roomAlias'))

  if (!roomAlias.startsWith('#') || !roomAlias.includes(':')) {
    return matrixError(c, 'M_INVALID_PARAM', 'Invalid room alias format')
  }

  const body = await c.req.json()
  const roomId = body.room_id
  if (!roomId) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing room_id')
  }

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  try {
    db.insert(roomAliases).values({ alias: roomAlias, roomId }).run()
  }
  catch {
    return c.json({ errcode: 'M_UNKNOWN', error: 'Room alias already exists' }, 409)
  }

  return c.json({})
})

// GET /:roomAlias — Resolve alias (public, no auth)
roomAliasRoute.get('/:roomAlias', async (c) => {
  const roomAlias = decodeURIComponent(c.req.param('roomAlias'))

  const alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomAlias)).get()
  if (!alias) {
    return matrixNotFound(c, 'Room alias not found')
  }

  return c.json({ room_id: alias.roomId, servers: [serverName] })
})

// DELETE /:roomAlias — Delete alias (requires auth)
roomAliasRoute.delete('/:roomAlias', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const roomAlias = decodeURIComponent(c.req.param('roomAlias'))

  const alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomAlias)).get()
  if (!alias) {
    return matrixNotFound(c, 'Room alias not found')
  }

  const membership = getRoomMembership(alias.roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  db.delete(roomAliases).where(eq(roomAliases.alias, roomAlias)).run()
  return c.json({})
})

// ---- Room Summary (MSC3266) ----

// Try to extract userId from token without failing on missing/invalid auth
function tryExtractUserId(c: any): string | undefined {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : c.req.query('access_token')
  if (!token)
    return undefined

  const oauthRow = db.select({ accountId: oauthTokens.accountId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.id, `AccessToken:${token}`), eq(oauthTokens.type, 'AccessToken')))
    .get()
  if (oauthRow?.accountId) {
    return oauthRow.accountId.startsWith('@') ? oauthRow.accountId : `@${oauthRow.accountId}:${serverName}`
  }

  const userToken = db.select({ userId: accountTokens.userId })
    .from(accountTokens)
    .where(eq(accountTokens.token, token))
    .get()
  return userToken?.userId
}

export const roomSummaryRoute = new Hono()

roomSummaryRoute.get('/:roomIdOrAlias/summary', async (c) => {
  const rawId = decodeURIComponent(c.req.param('roomIdOrAlias'))

  // Resolve alias to room ID
  let roomId = rawId
  if (rawId.startsWith('#')) {
    const alias = db.select({ roomId: roomAliases.roomId })
      .from(roomAliases)
      .where(eq(roomAliases.alias, rawId))
      .get()
    if (!alias)
      return matrixNotFound(c, 'Room alias not found')
    roomId = alias.roomId
  }

  const userId = tryExtractUserId(c)
  const summary = getRoomSummary(roomId, userId)
  if (!summary)
    return matrixNotFound(c, 'Room not found or not accessible')

  return c.json(summary)
})
