import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountData, currentRoomState, eventsState, eventsTimeline, readReceipts, typingNotifications } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { getRoomMembership, getUserPowerLevel } from '@/modules/room/service'
import { notifyUser } from '@/modules/sync/notifier'
import { parseEventId, queryEventById, queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEvent, formatEventListWithRelations, formatEventWithRelations } from '@/shared/helpers/formatEvent'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { eventContent, validate } from '@/shared/validation'
import { generateUlid } from '@/utils/tokens'

export const messageRouter = new Hono<AuthEnv>()

messageRouter.use('/*', authMiddleware)

// Helper to extract roomId from the path
function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

// Helper to get power levels content for a room
function getPowerLevelsContent(roomId: string): Record<string, any> {
  const stateRow = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(and(
      eq(currentRoomState.roomId, roomId),
      eq(currentRoomState.type, 'm.room.power_levels'),
      eq(currentRoomState.stateKey, ''),
    ))
    .get()

  if (!stateRow)
    return {}

  const event = db.select({ content: eventsState.content })
    .from(eventsState)
    .where(eq(eventsState.id, stateRow.eventId))
    .get()

  return (event?.content as Record<string, any>) ?? {}
}

// PUT /rooms/:roomId/send/:eventType/:txnId
messageRouter.put('/:roomId/send/:eventType/:txnId', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const txnId = c.req.param('txnId')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const content = await c.req.json()

  const v = validate(c, eventContent, content)
  if (!v.success)
    return v.response

  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: eventType,
    content: v.data,
    unsigned: { transaction_id: txnId },
  })

  return c.json({ event_id: event.event_id })
})

// GET /rooms/:roomId/messages
messageRouter.get('/:roomId/messages', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const from = c.req.query('from')
  const dir = c.req.query('dir') || 'b'
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 100)

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const rows = queryRoomEvents(roomId, {
    ...(dir === 'b' && from ? { before: from } : {}),
    ...(dir === 'f' && from ? { after: from } : {}),
    order: dir === 'b' ? 'desc' : 'asc',
    limit,
  })

  const chunk = formatEventListWithRelations(rows)

  const startToken = from || (rows[0] ? rows[0].id : '0')
  const endToken = rows.length > 0 ? rows[rows.length - 1]!.id : startToken

  return c.json({ start: startToken, end: endToken, chunk })
})

// GET /rooms/:roomId/event/:eventId
messageRouter.get('/:roomId/event/:eventId', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const eventId = parseEventId(c.req.param('eventId'))

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const event = queryEventById(eventId)
  if (!event || event.roomId !== roomId)
    return matrixNotFound(c, 'Event not found')

  return c.json(formatEventWithRelations(event))
})

// PUT /rooms/:roomId/redact/:eventId/:txnId
messageRouter.put('/:roomId/redact/:eventId/:txnId', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const targetEventId = parseEventId(c.req.param('eventId'))
  const txnId = c.req.param('txnId')

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const targetEvent = queryEventById(targetEventId)
  if (!targetEvent || targetEvent.roomId !== roomId)
    return matrixNotFound(c, 'Event not found')

  // Power level check: user needs 'redact' power level OR must be the event sender
  const powerLevels = getPowerLevelsContent(roomId)
  const userPower = getUserPowerLevel(roomId, auth.userId)
  const redactLevel = (powerLevels.redact as number) ?? 50
  if (userPower < redactLevel && targetEvent.sender !== auth.userId)
    return matrixForbidden(c, 'Insufficient power level')

  const body = await c.req.json().catch(() => ({}))

  // Build redacted content based on event type
  const preservedKeysByType: Record<string, string[]> = {
    'm.room.member': ['membership', 'join_authorised_via_users_server', 'third_party_invite'],
    'm.room.create': ['creator', 'room_version'],
    'm.room.join_rules': ['join_rule', 'allow'],
    'm.room.history_visibility': ['history_visibility'],
  }

  const originalContent = (targetEvent.content as Record<string, any>) ?? {}
  let redactedContent: Record<string, any> = {}

  if (targetEvent.type === 'm.room.power_levels') {
    redactedContent = { ...originalContent }
  }
  else {
    const preservedKeys = preservedKeysByType[targetEvent.type as string]
    if (preservedKeys) {
      for (const key of preservedKeys) {
        if (key in originalContent) {
          redactedContent[key] = originalContent[key]
        }
      }
    }
  }

  const redactionEvent = createEvent({
    roomId,
    sender: auth.userId,
    type: 'm.room.redaction',
    content: { redacts: `$${targetEventId}`, ...(body.reason ? { reason: body.reason } : {}) },
    unsigned: { transaction_id: txnId },
  })

  const redactedBecause = {
    event_id: redactionEvent.event_id,
    room_id: roomId,
    sender: auth.userId,
    type: 'm.room.redaction',
    content: { redacts: `$${targetEventId}`, ...(body.reason ? { reason: body.reason } : {}) },
    origin_server_ts: Date.now(),
  }

  // Update the correct table based on whether it's a state or timeline event
  if (targetEvent.stateKey !== null && targetEvent.stateKey !== undefined) {
    db.update(eventsState)
      .set({
        content: redactedContent,
        unsigned: { redacted_because: redactedBecause },
      })
      .where(eq(eventsState.id, targetEventId))
      .run()
  }
  else {
    db.update(eventsTimeline)
      .set({
        content: redactedContent,
        unsigned: { redacted_because: redactedBecause },
      })
      .where(eq(eventsTimeline.id, targetEventId))
      .run()
  }

  return c.json({ event_id: redactionEvent.event_id })
})

// GET /rooms/:roomId/state
messageRouter.get('/:roomId/state', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const stateRows = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(eq(currentRoomState.roomId, roomId))
    .all()

  const eventIds = stateRows.map(r => r.eventId)
  if (eventIds.length === 0)
    return c.json([])

  const { inArray } = await import('drizzle-orm')
  const allStateEvents = db.select().from(eventsState).where(inArray(eventsState.id, eventIds)).all()

  return c.json(allStateEvents.map(e => ({
    event_id: `$${e.id}`,
    room_id: e.roomId,
    sender: e.sender,
    type: e.type,
    state_key: e.stateKey ?? '',
    content: e.content,
    origin_server_ts: e.originServerTs,
  })))
})

// GET /rooms/:roomId/state/:eventType
messageRouter.get('/:roomId/state/:eventType', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')

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

  if (!stateRow)
    return matrixNotFound(c, 'State event not found')

  const event = db.select({ content: eventsState.content }).from(eventsState).where(eq(eventsState.id, stateRow.eventId)).get()
  return c.json(event?.content ?? {})
})

// GET /rooms/:roomId/state/:eventType/:stateKey
messageRouter.get('/:roomId/state/:eventType/:stateKey', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''

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

  if (!stateRow)
    return matrixNotFound(c, 'State event not found')

  const event = db.select({ content: eventsState.content }).from(eventsState).where(eq(eventsState.id, stateRow.eventId)).get()
  return c.json(event?.content ?? {})
})

// PUT /rooms/:roomId/state/:eventType/:stateKey?
messageRouter.put('/:roomId/state/:eventType/:stateKey?', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join')
    return matrixForbidden(c, 'Not a member of this room')

  const powerLevels = getPowerLevelsContent(roomId)
  const userPower = getUserPowerLevel(roomId, auth.userId)
  const eventsMap = (powerLevels.events as Record<string, number>) ?? {}
  const requiredLevel = eventsMap[eventType] ?? (powerLevels.state_default as number) ?? 50
  if (userPower < requiredLevel)
    return matrixForbidden(c, 'Insufficient power level')

  const content = await c.req.json()

  const v = validate(c, eventContent, content)
  if (!v.success)
    return v.response

  const event = createEvent({
    roomId,
    sender: auth.userId,
    type: eventType,
    stateKey,
    content: v.data,
  })

  return c.json({ event_id: event.event_id })
})

// PUT /rooms/:roomId/typing/:userId
messageRouter.put('/:roomId/typing/:userId', async (c) => {
  const auth = c.get('auth')
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
messageRouter.post('/:roomId/receipt/:receiptType/:eventId', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const receiptType = c.req.param('receiptType')
  const eventId = parseEventId(c.req.param('eventId'))

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
messageRouter.post('/:roomId/read_markers', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const body = await c.req.json()

  const markers: Array<{ eventId: string, receiptType: string }> = []
  if (body['m.fully_read'])
    markers.push({ eventId: parseEventId(body['m.fully_read']), receiptType: 'm.fully_read' })
  if (body['m.read'])
    markers.push({ eventId: parseEventId(body['m.read']), receiptType: 'm.read' })
  if (body['m.read.private'])
    markers.push({ eventId: parseEventId(body['m.read.private']), receiptType: 'm.read.private' })

  for (const { eventId, receiptType } of markers) {
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
  }

  return c.json({})
})

// GET /rooms/:roomId/context/:eventId
messageRouter.get('/:roomId/context/:eventId', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const eventId = parseEventId(c.req.param('eventId'))

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const target = queryEventById(eventId)
  if (!target || target.roomId !== roomId)
    return matrixNotFound(c, 'Event not found')

  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') || '10'), 0), 100)
  const half = Math.floor(limit / 2)

  const eventsBefore = queryRoomEvents(roomId, { before: target.id, order: 'desc', limit: half })
  const eventsAfter = queryRoomEvents(roomId, { after: target.id, order: 'asc', limit: half })

  // Get current room state
  const stateRows = db.select({ eventId: currentRoomState.eventId })
    .from(currentRoomState)
    .where(eq(currentRoomState.roomId, roomId))
    .all()

  const { inArray } = await import('drizzle-orm')
  const stateEventIds = stateRows.map(r => r.eventId)
  const currentState = stateEventIds.length > 0
    ? db.select().from(eventsState).where(inArray(eventsState.id, stateEventIds)).all()
    : []

  const start = eventsBefore.length > 0 ? eventsBefore[eventsBefore.length - 1]!.id : target.id
  const end = eventsAfter.length > 0 ? eventsAfter[eventsAfter.length - 1]!.id : target.id

  return c.json({
    event: formatEventWithRelations(target),
    events_before: formatEventListWithRelations(eventsBefore),
    events_after: formatEventListWithRelations(eventsAfter),
    start,
    end,
    state: currentState.map(formatEvent),
  })
})

// GET /rooms/:roomId/account_data/:type
messageRouter.get('/:roomId/account_data/:type', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const dataType = c.req.param('type')

  const row = db.select().from(accountData).where(and(
    eq(accountData.userId, auth.userId),
    eq(accountData.roomId, roomId),
    eq(accountData.type, dataType),
  )).get()

  if (!row)
    return matrixNotFound(c, 'Account data not found')
  return c.json(row.content)
})

// PUT /rooms/:roomId/account_data/:type
messageRouter.put('/:roomId/account_data/:type', async (c) => {
  const auth = c.get('auth')
  const roomId = getRoomId(c)
  const dataType = c.req.param('type')
  const content = await c.req.json()

  const streamId = generateUlid()

  db.insert(accountData).values({
    userId: auth.userId,
    type: dataType,
    roomId,
    content,
    streamId,
  }).onConflictDoUpdate({
    target: [accountData.userId, accountData.type, accountData.roomId],
    set: { content, streamId },
  }).run()

  notifyUser(auth.userId)

  return c.json({})
})
