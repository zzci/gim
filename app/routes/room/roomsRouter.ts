import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { rooms, readReceipts, typingNotifications, accountData } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixError, matrixNotFound, matrixForbidden } from '@/middleware/errors'
import { createEvent } from '@/services/events'
import { getRoomMembership, getRoomJoinRule, getUserPowerLevel } from '@/services/rooms'

/**
 * Single router for all /rooms/:roomId/* endpoints.
 * This avoids Hono's sub-router param propagation issue.
 */
export const roomsRouter = new Hono()

roomsRouter.use('/*', authMiddleware)

// Helper to extract roomId from the path
function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

// POST /rooms/:roomId/join
roomsRouter.post('/:roomId/join', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) return matrixNotFound(c, 'Room not found')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership === 'join') return c.json({ room_id: roomId })
  if (membership === 'ban') return matrixForbidden(c, 'You are banned')

  const joinRule = getRoomJoinRule(roomId)
  if (joinRule === 'invite' && membership !== 'invite') {
    return matrixForbidden(c, 'You are not invited to this room')
  }

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: auth.userId,
    content: { membership: 'join' },
  })

  return c.json({ room_id: roomId })
})

// POST /rooms/:roomId/leave
roomsRouter.post('/:roomId/leave', async (c) => {
  const auth = c.get('auth') as AuthContext
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

  return c.json({})
})

// POST /rooms/:roomId/invite
roomsRouter.post('/:roomId/invite', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const body = await c.req.json()
  const targetUserId = body.user_id

  if (!targetUserId) return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')

  const senderMembership = getRoomMembership(roomId, auth.userId)
  if (senderMembership !== 'join') return matrixForbidden(c, 'Not a member of this room')

  const targetMembership = getRoomMembership(roomId, targetUserId)
  if (targetMembership === 'join') return matrixError(c, 'M_UNKNOWN', 'User already in room')
  if (targetMembership === 'ban') return matrixForbidden(c, 'User is banned')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: targetUserId,
    content: { membership: 'invite' },
  })

  return c.json({})
})

// POST /rooms/:roomId/kick
roomsRouter.post('/:roomId/kick', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const body = await c.req.json()

  if (!body.user_id) return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')

  const senderPower = getUserPowerLevel(roomId, auth.userId)
  const targetPower = getUserPowerLevel(roomId, body.user_id)
  if (senderPower <= targetPower) return matrixForbidden(c, 'Insufficient power level')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: body.user_id,
    content: { membership: 'leave', ...(body.reason ? { reason: body.reason } : {}) },
  })

  return c.json({})
})

// POST /rooms/:roomId/ban
roomsRouter.post('/:roomId/ban', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const body = await c.req.json()

  if (!body.user_id) return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')

  const senderPower = getUserPowerLevel(roomId, auth.userId)
  const targetPower = getUserPowerLevel(roomId, body.user_id)
  if (senderPower <= targetPower) return matrixForbidden(c, 'Insufficient power level')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: body.user_id,
    content: { membership: 'ban', ...(body.reason ? { reason: body.reason } : {}) },
  })

  return c.json({})
})

// POST /rooms/:roomId/unban
roomsRouter.post('/:roomId/unban', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const body = await c.req.json()

  if (!body.user_id) return matrixError(c, 'M_MISSING_PARAM', 'Missing user_id')

  const membership = getRoomMembership(roomId, body.user_id)
  if (membership !== 'ban') return matrixError(c, 'M_UNKNOWN', 'User is not banned')

  createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.member',
    stateKey: body.user_id,
    content: { membership: 'leave' },
  })

  return c.json({})
})

// GET /rooms/:roomId/state
roomsRouter.get('/:roomId/state', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const { currentRoomState, events } = await import('@/db/schema')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const stateRows = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(eq(currentRoomState.roomId, roomId))
    .all()

  const eventIds = stateRows.map(r => r.eventId)
  if (eventIds.length === 0) return c.json([])

  const allEvents = db.select().from(events).where(eq(events.roomId, roomId)).all()
  const stateEvents = allEvents.filter(e => eventIds.includes(e.id))

  return c.json(stateEvents.map(e => ({
    event_id: e.id,
    room_id: e.roomId,
    sender: e.sender,
    type: e.type,
    state_key: e.stateKey ?? '',
    content: e.content,
    origin_server_ts: e.originServerTs,
  })))
})

// GET /rooms/:roomId/state/:eventType
roomsRouter.get('/:roomId/state/:eventType', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const { currentRoomState, events } = await import('@/db/schema')
  const { and } = await import('drizzle-orm')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, eventType),
      eq(currentRoomState.stateKey, ''),
    ))
    .get()

  if (!stateRow) return matrixNotFound(c, 'State event not found')

  const event = db.select({ content: events.content }).from(events).where(eq(events.id, stateRow.eventId)).get()
  return c.json(event?.content ?? {})
})

// GET /rooms/:roomId/state/:eventType/:stateKey
roomsRouter.get('/:roomId/state/:eventType/:stateKey', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''
  const { currentRoomState, events } = await import('@/db/schema')
  const { and } = await import('drizzle-orm')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, eventType),
      eq(currentRoomState.stateKey, stateKey),
    ))
    .get()

  if (!stateRow) return matrixNotFound(c, 'State event not found')

  const event = db.select({ content: events.content }).from(events).where(eq(events.id, stateRow.eventId)).get()
  return c.json(event?.content ?? {})
})

// PUT /rooms/:roomId/state/:eventType/:stateKey?
roomsRouter.put('/:roomId/state/:eventType/:stateKey?', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') return matrixForbidden(c, 'Not a member of this room')

  const content = await c.req.json()
  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: eventType,
    stateKey,
    content,
  })

  return c.json({ event_id: event.event_id })
})

// GET /rooms/:roomId/members
roomsRouter.get('/:roomId/members', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const membershipFilter = c.req.query('membership')
  const { roomMembers, events } = await import('@/db/schema')

  const userMembership = getRoomMembership(roomId, auth.userId)
  if (userMembership !== 'join' && userMembership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const rows = db.select().from(roomMembers).where(eq(roomMembers.roomId, roomId)).all()
  const filtered = membershipFilter ? rows.filter(r => r.membership === membershipFilter) : rows

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

// PUT /rooms/:roomId/send/:eventType/:txnId
roomsRouter.put('/:roomId/send/:eventType/:txnId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const txnId = c.req.param('txnId')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') return matrixForbidden(c, 'Not a member of this room')

  const content = await c.req.json()
  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: eventType,
    content,
    unsigned: { transaction_id: txnId },
  })

  return c.json({ event_id: event.event_id })
})

// GET /rooms/:roomId/messages
roomsRouter.get('/:roomId/messages', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const from = c.req.query('from')
  const dir = c.req.query('dir') || 'b'
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 100)
  const { events } = await import('@/db/schema')
  const { and, gt, lt, asc, desc } = await import('drizzle-orm')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const fromOrder = from ? Number.parseInt(from) : undefined
  const conditions = [eq(events.roomId, roomId)]
  if (dir === 'b' && fromOrder !== undefined) {
    conditions.push(lt(events.streamOrder, fromOrder))
  }
  else if (dir === 'f' && fromOrder !== undefined) {
    conditions.push(gt(events.streamOrder, fromOrder))
  }

  const rows = db.select().from(events)
    .where(and(...conditions))
    .orderBy(dir === 'b' ? desc(events.streamOrder) : asc(events.streamOrder))
    .limit(limit)
    .all()

  const chunk = rows.map(e => ({
    event_id: e.id,
    room_id: e.roomId,
    sender: e.sender,
    type: e.type,
    content: e.content,
    origin_server_ts: e.originServerTs,
    ...(e.stateKey !== null ? { state_key: e.stateKey } : {}),
  }))

  const startToken = from || (rows[0] ? String(rows[0].streamOrder) : '0')
  const endToken = rows.length > 0 ? String(rows[rows.length - 1]!.streamOrder) : startToken

  return c.json({ start: startToken, end: endToken, chunk })
})

// GET /rooms/:roomId/event/:eventId
roomsRouter.get('/:roomId/event/:eventId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const eventId = c.req.param('eventId')
  const { events } = await import('@/db/schema')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const event = db.select().from(events).where(eq(events.id, eventId)).get()
  if (!event || event.roomId !== roomId) return matrixNotFound(c, 'Event not found')

  return c.json({
    event_id: event.id,
    room_id: event.roomId,
    sender: event.sender,
    type: event.type,
    content: event.content,
    origin_server_ts: event.originServerTs,
    ...(event.stateKey !== null ? { state_key: event.stateKey } : {}),
  })
})

// PUT /rooms/:roomId/redact/:eventId/:txnId
roomsRouter.put('/:roomId/redact/:eventId/:txnId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const targetEventId = c.req.param('eventId')
  const txnId = c.req.param('txnId')
  const { events } = await import('@/db/schema')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') return matrixForbidden(c, 'Not a member of this room')

  const targetEvent = db.select().from(events).where(eq(events.id, targetEventId)).get()
  if (!targetEvent || targetEvent.roomId !== roomId) return matrixNotFound(c, 'Event not found')

  const body = await c.req.json().catch(() => ({}))

  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.redaction',
    content: { redacts: targetEventId, ...(body.reason ? { reason: body.reason } : {}) },
    unsigned: { transaction_id: txnId },
  })

  db.update(events).set({ content: {} }).where(eq(events.id, targetEventId)).run()

  return c.json({ event_id: event.event_id })
})

// PUT /rooms/:roomId/typing/:userId
roomsRouter.put('/:roomId/typing/:userId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const body = await c.req.json()

  if (body.typing) {
    const timeout = Math.min(body.timeout || 30000, 30000)
    db.insert(typingNotifications).values({
      roomId,
      userId: auth.userId,
      expiresAt: Date.now() + timeout,
    }).onConflictDoUpdate({
      target: [typingNotifications.roomId, typingNotifications.userId],
      set: { expiresAt: Date.now() + timeout },
    }).run()
  }
  else {
    db.delete(typingNotifications)
      .where(and(
        eq(typingNotifications.roomId, roomId),
        eq(typingNotifications.userId, auth.userId),
      ))
      .run()
  }

  return c.json({})
})

// POST /rooms/:roomId/receipt/:receiptType/:eventId
roomsRouter.post('/:roomId/receipt/:receiptType/:eventId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const receiptType = c.req.param('receiptType')
  const eventId = c.req.param('eventId')

  db.insert(readReceipts).values({
    roomId,
    userId: auth.userId,
    eventId,
    receiptType,
    ts: Date.now(),
  }).onConflictDoUpdate({
    target: [readReceipts.roomId, readReceipts.userId, readReceipts.receiptType],
    set: { eventId, ts: Date.now() },
  }).run()

  return c.json({})
})

// POST /rooms/:roomId/read_markers
roomsRouter.post('/:roomId/read_markers', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const body = await c.req.json()

  if (body['m.fully_read']) {
    db.insert(readReceipts).values({
      roomId,
      userId: auth.userId,
      eventId: body['m.fully_read'],
      receiptType: 'm.fully_read',
      ts: Date.now(),
    }).onConflictDoUpdate({
      target: [readReceipts.roomId, readReceipts.userId, readReceipts.receiptType],
      set: { eventId: body['m.fully_read'], ts: Date.now() },
    }).run()
  }

  if (body['m.read']) {
    db.insert(readReceipts).values({
      roomId,
      userId: auth.userId,
      eventId: body['m.read'],
      receiptType: 'm.read',
      ts: Date.now(),
    }).onConflictDoUpdate({
      target: [readReceipts.roomId, readReceipts.userId, readReceipts.receiptType],
      set: { eventId: body['m.read'], ts: Date.now() },
    }).run()
  }

  if (body['m.read.private']) {
    db.insert(readReceipts).values({
      roomId,
      userId: auth.userId,
      eventId: body['m.read.private'],
      receiptType: 'm.read.private',
      ts: Date.now(),
    }).onConflictDoUpdate({
      target: [readReceipts.roomId, readReceipts.userId, readReceipts.receiptType],
      set: { eventId: body['m.read.private'], ts: Date.now() },
    }).run()
  }

  return c.json({})
})

// GET/PUT /rooms/:roomId/account_data/:type
roomsRouter.get('/:roomId/account_data/:type', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const dataType = c.req.param('type')

  const row = db.select().from(accountData)
    .where(and(
      eq(accountData.userId, auth.userId),
      eq(accountData.roomId, roomId),
      eq(accountData.type, dataType),
    ))
    .get()

  if (!row) return matrixNotFound(c, 'Account data not found')
  return c.json(row.content)
})

roomsRouter.put('/:roomId/account_data/:type', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = getRoomId(c)
  const dataType = c.req.param('type')
  const content = await c.req.json()

  db.insert(accountData).values({
    userId: auth.userId,
    type: dataType,
    roomId,
    content,
  }).onConflictDoUpdate({
    target: [accountData.userId, accountData.type, accountData.roomId],
    set: { content },
  }).run()

  return c.json({})
})
