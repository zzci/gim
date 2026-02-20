import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, eventsState, eventsTimeline, roomMembers } from '@/db/schema'
import { getUserPowerLevel } from '@/models/roomState'
import { createEvent } from '@/modules/message/service'
import { getPowerLevelsContent, getRoomId } from '@/modules/message/shared'
import { getRoomMembership } from '@/modules/room/service'
import { parseEventId, queryEventById } from '@/shared/helpers/eventQueries'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

export function registerRedactRoute(router: Hono<AuthEnv>) {
  // PUT /rooms/:roomId/redact/:eventId/:txnId
  router.put('/:roomId/redact/:eventId/:txnId', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const targetEventId = parseEventId(c.req.param('eventId'))
    const txnId = c.req.param('txnId')

    const membership = await getRoomMembership(roomId, auth.userId)
    if (membership !== 'join')
      return matrixForbidden(c, 'Not a member of this room')

    const targetEvent = queryEventById(targetEventId)
    if (!targetEvent || targetEvent.roomId !== roomId)
      return matrixNotFound(c, 'Event not found')

    // Power level check: user needs 'redact' power level OR must be the event sender
    const powerLevels = await getPowerLevelsContent(roomId)
    const userPower = await getUserPowerLevel(roomId, auth.userId)
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

    const redactionEvent = await createEvent({
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

      // If this is the current state event for this type+stateKey, update materialized views
      const isCurrent = db.select({ eventId: currentRoomState.eventId })
        .from(currentRoomState)
        .where(and(
          eq(currentRoomState.roomId, roomId),
          eq(currentRoomState.type, targetEvent.type as string),
          eq(currentRoomState.stateKey, targetEvent.stateKey as string),
          eq(currentRoomState.eventId, targetEventId),
        ))
        .get()

      if (isCurrent && targetEvent.type === 'm.room.member') {
        // Redacted m.room.member preserves 'membership' key, update roomMembers
        const membership = (redactedContent.membership as string) || 'leave'
        db.update(roomMembers)
          .set({ membership, updatedAt: new Date() })
          .where(and(
            eq(roomMembers.roomId, roomId),
            eq(roomMembers.userId, targetEvent.stateKey as string),
          ))
          .run()
      }
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
}
