import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { requireEncryption } from '@/config'
import { db } from '@/db'
import { currentRoomState, eventsState } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { getPowerLevelsContent, getRoomId } from '@/modules/message/shared'
import { getRoomMembership, getUserPowerLevel } from '@/modules/room/service'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { eventContent, validate } from '@/shared/validation'

export function registerStateRoutes(router: Hono<AuthEnv>) {
  // GET /rooms/:roomId/state
  router.get('/:roomId/state', async (c) => {
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
  router.get('/:roomId/state/:eventType', async (c) => {
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
  router.get('/:roomId/state/:eventType/:stateKey', async (c) => {
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

  // PUT /rooms/:roomId/state/:eventType — without stateKey
  // PUT /rooms/:roomId/state/:eventType/:stateKey — with stateKey (including empty via trailing slash)
  async function putStateHandler(c: any) {
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

    // Prevent disabling encryption when requireEncryption is on
    if (requireEncryption && eventType === 'm.room.encryption') {
      const existing = db.select({ eventId: currentRoomState.eventId })
        .from(currentRoomState)
        .where(and(
          eq(currentRoomState.roomId, roomId),
          eq(currentRoomState.type, 'm.room.encryption'),
          eq(currentRoomState.stateKey, ''),
        ))
        .get()
      if (existing)
        return matrixForbidden(c, 'Cannot modify encryption settings')
    }

    // Extra validation for m.room.power_levels changes
    if (eventType === 'm.room.power_levels') {
      const content = await c.req.json()
      const newUsers = (content.users as Record<string, number>) ?? {}

      // Cannot set any user's power level higher than your own
      for (const [uid, level] of Object.entries(newUsers)) {
        if (level > userPower)
          return matrixForbidden(c, `Cannot set power level higher than your own (${userPower})`)
        // Cannot demote a user whose current level >= your own (unless it's yourself)
        if (uid !== auth.userId) {
          const currentUsers = (powerLevels.users as Record<string, number>) ?? {}
          const currentLevel = currentUsers[uid] ?? ((powerLevels.users_default as number) ?? 0)
          if (currentLevel >= userPower && level !== currentLevel)
            return matrixForbidden(c, 'Cannot modify power level of user with equal or higher power')
        }
      }

      // Cannot set level fields higher than your own power level
      for (const key of ['events_default', 'state_default', 'ban', 'kick', 'invite', 'redact', 'users_default'] as const) {
        if (key in content && typeof content[key] === 'number' && content[key] > userPower)
          return matrixForbidden(c, `Cannot set ${key} higher than your own power level`)
      }

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
    }

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
  }

  router.put('/:roomId/state/:eventType', putStateHandler)
  router.put('/:roomId/state/:eventType/:stateKey', putStateHandler)
}
