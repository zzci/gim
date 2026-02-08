import { eq, sql, and, max } from 'drizzle-orm'
import { db } from '@/db'
import { events, currentRoomState, roomMembers } from '@/db/schema'
import { serverName } from '@/config'
import { generateEventId } from '@/utils/tokens'
import { getRedis } from '@/redis'

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

// Get next stream order atomically
function getNextStreamOrder(): number {
  const result = db.select({ maxOrder: max(events.streamOrder) }).from(events).get()
  return (result?.maxOrder ?? 0) + 1
}

// Get current room depth
function getRoomDepth(roomId: string): number {
  const result = db.select({ maxDepth: max(events.depth) })
    .from(events)
    .where(eq(events.roomId, roomId))
    .get()
  return (result?.maxDepth ?? 0) + 1
}

export function createEvent(input: EventInput): MatrixEvent {
  const eventId = generateEventId()
  const originServerTs = Date.now()
  const streamOrder = getNextStreamOrder()
  const depth = getRoomDepth(input.roomId)

  // Insert event
  db.insert(events).values({
    id: eventId,
    roomId: input.roomId,
    sender: input.sender,
    type: input.type,
    stateKey: input.stateKey ?? null,
    content: input.content,
    originServerTs,
    unsigned: input.unsigned ?? null,
    depth,
    streamOrder,
  }).run()

  // If this is a state event, update current_room_state
  if (input.stateKey !== undefined) {
    db.insert(currentRoomState).values({
      roomId: input.roomId,
      type: input.type,
      stateKey: input.stateKey,
      eventId,
    }).onConflictDoUpdate({
      target: [currentRoomState.roomId, currentRoomState.type, currentRoomState.stateKey],
      set: { eventId },
    }).run()
  }

  // If this is a membership event, update room_members
  if (input.type === 'm.room.member' && input.stateKey !== undefined) {
    const membership = (input.content.membership as string) || 'leave'
    db.insert(roomMembers).values({
      roomId: input.roomId,
      userId: input.stateKey,
      membership,
      eventId,
    }).onConflictDoUpdate({
      target: [roomMembers.roomId, roomMembers.userId],
      set: { membership, eventId, updatedAt: new Date() },
    }).run()
  }

  // Notify via Redis pub/sub (non-blocking)
  notifyRoomMembers(input.roomId).catch(() => {})

  const event: MatrixEvent = {
    event_id: eventId,
    room_id: input.roomId,
    sender: input.sender,
    type: input.type,
    content: input.content,
    origin_server_ts: originServerTs,
  }

  if (input.stateKey !== undefined) {
    event.state_key = input.stateKey
  }
  if (input.unsigned) {
    event.unsigned = input.unsigned
  }

  return event
}

async function notifyRoomMembers(roomId: string) {
  const redis = await getRedis()
  if (!redis) return

  const members = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()

  for (const member of members) {
    await redis.publish(`sync:notify:${member.userId}`, roomId)
  }
}

// Get the current max stream order for sync tokens
export function getMaxStreamOrder(): number {
  const result = db.select({ maxOrder: max(events.streamOrder) }).from(events).get()
  return result?.maxOrder ?? 0
}
