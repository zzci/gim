import { eq, and, gt, lte, desc, asc } from 'drizzle-orm'
import { db } from '@/db'
import {
  events,
  roomMembers,
  currentRoomState,
  accountData,
  deviceKeys,
  oneTimeKeys,
  toDeviceMessages,
  readReceipts,
  typingNotifications,
} from '@/db/schema'
import { getMaxStreamOrder } from './events'

const DEFAULT_TIMELINE_LIMIT = 10

interface SyncOptions {
  userId: string
  deviceId: string
  since?: string
  timeout?: number
  fullState?: boolean
  setPresence?: string
}

interface JoinedRoomData {
  timeline: {
    events: any[]
    limited: boolean
    prev_batch: string
  }
  state: { events: any[] }
  account_data: { events: any[] }
  ephemeral: { events: any[] }
  unread_notifications: {
    highlight_count: number
    notification_count: number
  }
  summary: Record<string, any>
}

function formatEvent(e: any) {
  const result: any = {
    event_id: e.id,
    room_id: e.roomId,
    sender: e.sender,
    type: e.type,
    content: e.content,
    origin_server_ts: e.originServerTs,
  }
  if (e.stateKey !== null && e.stateKey !== undefined) {
    result.state_key = e.stateKey
  }
  if (e.unsigned) {
    result.unsigned = e.unsigned
  }
  return result
}

function buildJoinedRoomData(
  roomId: string,
  userId: string,
  sinceOrder: number | null,
): JoinedRoomData | null {
  // Get timeline events
  let timelineEvents: any[]
  let limited = false
  let prevBatch = '0'

  if (sinceOrder === null) {
    // Initial sync: get the latest N events
    timelineEvents = db.select().from(events)
      .where(eq(events.roomId, roomId))
      .orderBy(desc(events.streamOrder))
      .limit(DEFAULT_TIMELINE_LIMIT)
      .all()
      .reverse()

    if (timelineEvents.length === DEFAULT_TIMELINE_LIMIT) {
      limited = true
    }
    prevBatch = timelineEvents.length > 0 ? String(timelineEvents[0]!.streamOrder) : '0'
  }
  else {
    // Incremental sync: get events since last sync
    timelineEvents = db.select().from(events)
      .where(and(
        eq(events.roomId, roomId),
        gt(events.streamOrder, sinceOrder),
      ))
      .orderBy(asc(events.streamOrder))
      .limit(DEFAULT_TIMELINE_LIMIT)
      .all()

    // Check if there are more events we didn't include
    if (timelineEvents.length === DEFAULT_TIMELINE_LIMIT) {
      const totalNew = db.select().from(events)
        .where(and(
          eq(events.roomId, roomId),
          gt(events.streamOrder, sinceOrder),
        ))
        .all()
      if (totalNew.length > DEFAULT_TIMELINE_LIMIT) {
        limited = true
      }
    }

    prevBatch = String(sinceOrder)

    // If no new events in incremental sync, skip this room
    if (timelineEvents.length === 0) {
      return null
    }
  }

  // Get state events
  let stateEvents: any[] = []
  if (sinceOrder === null || limited) {
    // For initial sync or limited: include all current state
    const stateRows = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(eq(currentRoomState.roomId, roomId))
      .all()

    const eventIds = new Set(stateRows.map(r => r.eventId))
    // Exclude state events that are already in the timeline
    const timelineIds = new Set(timelineEvents.map(e => e.id))

    const allRoomEvents = db.select().from(events)
      .where(eq(events.roomId, roomId))
      .all()

    stateEvents = allRoomEvents.filter(
      e => eventIds.has(e.id) && !timelineIds.has(e.id),
    )
  }

  // Get room account data
  const roomAccountData = db.select().from(accountData)
    .where(and(
      eq(accountData.userId, userId),
      eq(accountData.roomId, roomId),
    ))
    .all()

  // Get room member counts for summary
  const joinedCount = db.select().from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .all().length

  const invitedCount = db.select().from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'invite'),
    ))
    .all().length

  // Get heroes (other members' user IDs for room name computation)
  const otherMembers = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.roomId, roomId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()
    .filter(m => m.userId !== userId)
    .slice(0, 5)
    .map(m => m.userId)

  // Ephemeral events: typing + receipts
  const ephemeralEvents: any[] = []

  // Typing notifications (clean expired)
  const now = Date.now()
  db.delete(typingNotifications)
    .where(lte(typingNotifications.expiresAt, now))
    .run()

  const typers = db.select({ userId: typingNotifications.userId })
    .from(typingNotifications)
    .where(eq(typingNotifications.roomId, roomId))
    .all()

  if (typers.length > 0) {
    ephemeralEvents.push({
      type: 'm.typing',
      content: {
        user_ids: typers.map(t => t.userId),
      },
    })
  }

  // Read receipts for this room
  const receipts = db.select().from(readReceipts)
    .where(eq(readReceipts.roomId, roomId))
    .all()

  if (receipts.length > 0) {
    const receiptContent: Record<string, Record<string, Record<string, { ts: number }>>> = {}
    for (const r of receipts) {
      if (!receiptContent[r.eventId]) receiptContent[r.eventId] = {}
      if (!receiptContent[r.eventId]![r.receiptType]) receiptContent[r.eventId]![r.receiptType] = {}
      receiptContent[r.eventId]![r.receiptType]![r.userId] = { ts: r.ts }
    }
    ephemeralEvents.push({
      type: 'm.receipt',
      content: receiptContent,
    })
  }

  // Notification counts: count events after user's last read receipt
  let notificationCount = 0
  const lastRead = db.select().from(readReceipts)
    .where(and(
      eq(readReceipts.roomId, roomId),
      eq(readReceipts.userId, userId),
      eq(readReceipts.receiptType, 'm.read'),
    ))
    .get()

  if (lastRead) {
    // Find the stream_order of the read event
    const readEvent = db.select({ streamOrder: events.streamOrder })
      .from(events)
      .where(eq(events.id, lastRead.eventId))
      .get()

    if (readEvent) {
      // Count non-state events after the read marker
      const unreadEvents = db.select().from(events)
        .where(and(
          eq(events.roomId, roomId),
          gt(events.streamOrder, readEvent.streamOrder),
        ))
        .all()
        .filter(e => e.stateKey === null) // Only count non-state events
      notificationCount = unreadEvents.length
    }
  }
  else if (sinceOrder !== null) {
    // No read receipt: count all events in the timeline
    notificationCount = timelineEvents.filter(e => e.stateKey === null).length
  }

  return {
    timeline: {
      events: timelineEvents.map(formatEvent),
      limited,
      prev_batch: prevBatch,
    },
    state: {
      events: stateEvents.map(formatEvent),
    },
    account_data: {
      events: roomAccountData.map(d => ({
        type: d.type,
        content: d.content,
      })),
    },
    ephemeral: { events: ephemeralEvents },
    unread_notifications: {
      highlight_count: 0,
      notification_count: notificationCount,
    },
    summary: {
      'm.heroes': otherMembers,
      'm.joined_member_count': joinedCount,
      'm.invited_member_count': invitedCount,
    },
  }
}

export function buildSyncResponse(opts: SyncOptions) {
  const sinceOrder = opts.since ? Number.parseInt(opts.since) : null

  // Get all rooms the user is a member of
  const memberRooms = db.select({
    roomId: roomMembers.roomId,
    membership: roomMembers.membership,
  })
    .from(roomMembers)
    .where(eq(roomMembers.userId, opts.userId))
    .all()

  const joinRooms: Record<string, JoinedRoomData> = {}
  const inviteRooms: Record<string, any> = {}
  const leaveRooms: Record<string, any> = {}

  for (const mr of memberRooms) {
    if (mr.membership === 'join') {
      const roomData = buildJoinedRoomData(mr.roomId, opts.userId, sinceOrder)
      if (roomData) {
        joinRooms[mr.roomId] = roomData
      }
    }
    else if (mr.membership === 'invite') {
      // Get invite state (stripped state events)
      const stateRows = db.select({ eventId: currentRoomState.eventId })
        .from(currentRoomState)
        .where(eq(currentRoomState.roomId, mr.roomId))
        .all()

      const inviteEvents = []
      for (const sr of stateRows) {
        const event = db.select().from(events).where(eq(events.id, sr.eventId)).get()
        if (event && ['m.room.create', 'm.room.name', 'm.room.member', 'm.room.canonical_alias', 'm.room.avatar', 'm.room.join_rules'].includes(event.type)) {
          inviteEvents.push(formatEvent(event))
        }
      }

      inviteRooms[mr.roomId] = {
        invite_state: { events: inviteEvents },
      }
    }
    // For 'leave' rooms, only include in incremental sync if there are new events
    else if (mr.membership === 'leave' && sinceOrder !== null) {
      const newEvents = db.select().from(events)
        .where(and(
          eq(events.roomId, mr.roomId),
          gt(events.streamOrder, sinceOrder),
        ))
        .all()
      if (newEvents.length > 0) {
        leaveRooms[mr.roomId] = {
          timeline: { events: newEvents.map(formatEvent) },
          state: { events: [] },
        }
      }
    }
  }

  // Global account data (only for initial sync)
  let globalAccountData: any[] = []
  if (sinceOrder === null) {
    globalAccountData = db.select().from(accountData)
      .where(and(
        eq(accountData.userId, opts.userId),
        eq(accountData.roomId, ''),
      ))
      .all()
      .map(d => ({ type: d.type, content: d.content }))
  }

  // Device one-time key counts
  const otkCount = db.select().from(oneTimeKeys)
    .where(and(
      eq(oneTimeKeys.userId, opts.userId),
      eq(oneTimeKeys.deviceId, opts.deviceId),
      eq(oneTimeKeys.claimed, false),
    ))
    .all().length

  // Fetch to-device messages
  const toDeviceMsgs = db.select().from(toDeviceMessages)
    .where(and(
      eq(toDeviceMessages.userId, opts.userId),
      eq(toDeviceMessages.deviceId, opts.deviceId),
    ))
    .all()

  const toDeviceEvents = toDeviceMsgs.map(m => ({
    type: m.type,
    sender: m.sender,
    content: m.content,
  }))

  // Delete delivered to-device messages
  if (toDeviceMsgs.length > 0) {
    for (const m of toDeviceMsgs) {
      db.delete(toDeviceMessages)
        .where(eq(toDeviceMessages.id, m.id))
        .run()
    }
  }

  const nextBatch = String(getMaxStreamOrder())

  return {
    next_batch: nextBatch,
    rooms: {
      join: joinRooms,
      invite: inviteRooms,
      leave: leaveRooms,
    },
    account_data: { events: globalAccountData },
    presence: { events: [] },
    to_device: { events: toDeviceEvents },
    device_one_time_keys_count: {
      signed_curve25519: otkCount,
    },
    device_unused_fallback_key_types: [],
  }
}
