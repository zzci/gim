import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { currentRoomState, eventsAttachments, eventsState, eventsTimeline, media, roomMembers } from '@/db/schema'
import { invalidateMemberCount, invalidateMembership } from '@/models/roomMembership'
import { invalidateStateContent } from '@/models/roomState'
import { recordNotifications } from '@/modules/notification/service'
import { notifyUser } from '@/modules/sync/notifier'
import { getMaxEventId } from '@/shared/helpers/eventQueries'
import { generateEventId } from '@/utils/tokens'

export interface EventInput {
  roomId: string
  sender: string
  type: string
  content: Record<string, unknown>
  stateKey?: string
  unsigned?: Record<string, unknown>
}

export interface MatrixEvent {
  event_id: string
  room_id: string
  sender: string
  type: string
  content: Record<string, unknown>
  origin_server_ts: number
  state_key?: string
  unsigned?: Record<string, unknown>
}

function extractMediaIds(content: Record<string, unknown>): string[] {
  const text = JSON.stringify(content)
  const matches = text.matchAll(/mxc:\/\/[^/]+\/([^"}\s]+)/g)
  return [...matches].map(m => m[1]!)
}

export async function createEvent(input: EventInput): Promise<MatrixEvent> {
  const event = db.transaction((tx) => {
    const id = generateEventId()
    const originServerTs = Date.now()

    if (input.stateKey !== undefined) {
      // State event → state_events table
      tx.insert(eventsState).values({
        id,
        roomId: input.roomId,
        sender: input.sender,
        type: input.type,
        stateKey: input.stateKey,
        content: input.content,
        originServerTs,
        unsigned: input.unsigned ?? null,
      }).run()

      // Update current_room_state
      tx.insert(currentRoomState).values({
        roomId: input.roomId,
        type: input.type,
        stateKey: input.stateKey,
        eventId: id,
      }).onConflictDoUpdate({
        target: [currentRoomState.roomId, currentRoomState.type, currentRoomState.stateKey],
        set: { eventId: id },
      }).run()

      // Update room_members for membership events
      if (input.type === 'm.room.member') {
        const membership = (input.content.membership as string) || 'leave'
        tx.insert(roomMembers).values({
          roomId: input.roomId,
          userId: input.stateKey,
          membership,
          eventId: id,
        }).onConflictDoUpdate({
          target: [roomMembers.roomId, roomMembers.userId],
          set: { membership, eventId: id, updatedAt: new Date() },
        }).run()
      }
    }
    else {
      // Timeline event → timeline_events table
      tx.insert(eventsTimeline).values({
        id,
        roomId: input.roomId,
        sender: input.sender,
        type: input.type,
        content: input.content,
        originServerTs,
        unsigned: input.unsigned ?? null,
      }).run()
    }

    // Scan for mxc:// URIs and record attachments
    const mediaIds = extractMediaIds(input.content)
    for (const mediaId of mediaIds) {
      const exists = tx.select({ id: media.id }).from(media).where(eq(media.id, mediaId)).get()
      if (exists) {
        tx.insert(eventsAttachments).values({ eventId: id, mediaId }).run()
      }
    }

    const result: MatrixEvent = {
      event_id: `$${id}`,
      room_id: input.roomId,
      sender: input.sender,
      type: input.type,
      content: input.content,
      origin_server_ts: originServerTs,
    }

    if (input.stateKey !== undefined) {
      result.state_key = input.stateKey
    }
    if (input.unsigned) {
      result.unsigned = input.unsigned
    }

    return result
  })

  // Invalidate caches on state changes that affect cached data
  if (input.stateKey !== undefined) {
    await invalidateStateContent(input.roomId, input.type, input.stateKey)
  }
  if (input.type === 'm.room.member') {
    await invalidateMemberCount(input.roomId)
    if (input.stateKey) {
      await invalidateMembership(input.roomId, input.stateKey)
    }
  }

  // Notify waiting sync connections — outside the transaction
  notifyRoomMembers(input.roomId).catch(() => {})

  // Record push notifications for room members
  try {
    await recordNotifications(event, input.roomId)
  }
  catch {}

  return event
}

async function notifyRoomMembers(roomId: string) {
  const members = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()

  const notified = new Set<string>()
  for (const member of members) {
    if (!notified.has(member.userId)) {
      notified.add(member.userId)
      notifyUser(member.userId)
    }
  }
}

// Re-export for sync service
export { getMaxEventId }
