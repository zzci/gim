import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { requireEncryption } from '@/config'
import { getMembership } from '@/models/roomMembership'
import { getAllStateEventIds, getStateContent, getStateEventsByIds, getUserPowerLevel } from '@/models/roomState'
import { createEvent } from '@/modules/message/service'
import { getPowerLevelsContent, getRoomId } from '@/modules/message/shared'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { eventContent, validate } from '@/shared/validation'

export function registerStateRoutes(router: Hono<AuthEnv>) {
  // GET /rooms/:roomId/state
  router.get('/:roomId/state', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)

    const membership = await getMembership(roomId, auth.userId)
    if (membership !== 'join' && membership !== 'invite') {
      return matrixForbidden(c, 'Not a member of this room')
    }

    const eventIds = getAllStateEventIds(roomId)
    if (eventIds.length === 0)
      return c.json([])

    const allStateEvents = getStateEventsByIds(eventIds)

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

    const membership = await getMembership(roomId, auth.userId)
    if (membership !== 'join' && membership !== 'invite') {
      return matrixForbidden(c, 'Not a member of this room')
    }

    const content = await getStateContent(roomId, eventType, '')
    if (content === null)
      return matrixNotFound(c, 'State event not found')

    return c.json(content)
  })

  // GET /rooms/:roomId/state/:eventType/:stateKey
  router.get('/:roomId/state/:eventType/:stateKey', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const eventType = c.req.param('eventType')
    const stateKey = c.req.param('stateKey') ?? ''

    const membership = await getMembership(roomId, auth.userId)
    if (membership !== 'join' && membership !== 'invite') {
      return matrixForbidden(c, 'Not a member of this room')
    }

    const content = await getStateContent(roomId, eventType, stateKey)
    if (content === null)
      return matrixNotFound(c, 'State event not found')

    return c.json(content)
  })

  // PUT /rooms/:roomId/state/:eventType — without stateKey
  // PUT /rooms/:roomId/state/:eventType/:stateKey — with stateKey (including empty via trailing slash)
  async function putStateHandler(c: any) {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const eventType = c.req.param('eventType')
    const stateKey = c.req.param('stateKey') ?? ''

    const membership = await getMembership(roomId, auth.userId)
    if (membership !== 'join')
      return matrixForbidden(c, 'Not a member of this room')

    const powerLevels = await getPowerLevelsContent(roomId)
    const userPower = await getUserPowerLevel(roomId, auth.userId)
    const eventsMap = (powerLevels.events as Record<string, number>) ?? {}
    const requiredLevel = eventsMap[eventType] ?? (powerLevels.state_default as number) ?? 50
    if (userPower < requiredLevel)
      return matrixForbidden(c, 'Insufficient power level')

    // Prevent disabling encryption when requireEncryption is on
    if (requireEncryption && eventType === 'm.room.encryption') {
      if (await getStateContent(roomId, 'm.room.encryption', '') !== null)
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

      const event = await createEvent({
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

    const event = await createEvent({
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
