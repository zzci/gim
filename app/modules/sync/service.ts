import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm'
import { db } from '@/db'
import {
  accountData,
  currentRoomState,
  devices,
  e2eeDeviceListChanges,
  e2eeFallbackKeys,
  e2eeOneTimeKeys,
  e2eeToDeviceMessages,
  eventsState,
  eventsTimeline,
  readReceipts,
  roomMembers,
  typingNotifications,
} from '@/db/schema'
import { getMaxEventId } from '@/modules/message/service'
import { getPresenceForRoommates } from '@/modules/presence/service'
import { queryEventById, queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEvent, formatEventWithRelations } from '@/shared/helpers/formatEvent'

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

function buildJoinedRoomData(
  roomId: string,
  userId: string,
  sinceId: string | null,
): JoinedRoomData | null {
  // Get timeline events (merged from both tables)
  let roomEvents: any[]
  let limited = false
  let prevBatch = ''

  if (sinceId === null) {
    // Initial sync: get the latest N events
    roomEvents = queryRoomEvents(roomId, { order: 'desc', limit: DEFAULT_TIMELINE_LIMIT })
    roomEvents.reverse()

    if (roomEvents.length === DEFAULT_TIMELINE_LIMIT) {
      limited = true
    }
    prevBatch = roomEvents.length > 0 ? roomEvents[0]!.id : ''
  }
  else {
    // Incremental sync: get events since last sync
    roomEvents = queryRoomEvents(roomId, { after: sinceId, order: 'asc', limit: DEFAULT_TIMELINE_LIMIT })

    // Check if there are more events we didn't include
    if (roomEvents.length === DEFAULT_TIMELINE_LIMIT) {
      const totalNew = queryRoomEvents(roomId, { after: sinceId, order: 'asc', limit: DEFAULT_TIMELINE_LIMIT + 1 })
      if (totalNew.length > DEFAULT_TIMELINE_LIMIT) {
        limited = true
      }
    }

    prevBatch = sinceId

    // If no new events in incremental sync, skip this room
    if (roomEvents.length === 0) {
      return null
    }
  }

  // Get state events
  let currentState: any[] = []
  if (sinceId === null || limited) {
    // For initial sync or limited: include all current state
    const stateRows = db.select({ eventId: currentRoomState.eventId })
      .from(currentRoomState)
      .where(eq(currentRoomState.roomId, roomId))
      .all()

    const eventIds = new Set(stateRows.map(r => r.eventId))
    // Exclude state events that are already in the timeline
    const timelineIds = new Set(roomEvents.map(e => e.id))

    const stateEventIds = [...eventIds].filter(id => !timelineIds.has(id))
    if (stateEventIds.length > 0) {
      currentState = db.select().from(eventsState).where(inArray(eventsState.id, stateEventIds)).all()
    }
  }

  // Get room account data
  const roomAccountData = db.select().from(accountData).where(and(
    eq(accountData.userId, userId),
    eq(accountData.roomId, roomId),
  )).all()

  // Get room member counts for summary
  const joinedCount = db.select().from(roomMembers).where(and(
    eq(roomMembers.roomId, roomId),
    eq(roomMembers.membership, 'join'),
  )).all().length

  const invitedCount = db.select().from(roomMembers).where(and(
    eq(roomMembers.roomId, roomId),
    eq(roomMembers.membership, 'invite'),
  )).all().length

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
  const receipts = db.select().from(readReceipts).where(eq(readReceipts.roomId, roomId)).all()

  if (receipts.length > 0) {
    const receiptContent: Record<string, Record<string, Record<string, { ts: number }>>> = {}
    for (const r of receipts) {
      const wireEventId = `$${r.eventId}`
      if (!receiptContent[wireEventId])
        receiptContent[wireEventId] = {}
      if (!receiptContent[wireEventId]![r.receiptType])
        receiptContent[wireEventId]![r.receiptType] = {}
      receiptContent[wireEventId]![r.receiptType]![r.userId] = { ts: r.ts }
    }
    ephemeralEvents.push({
      type: 'm.receipt',
      content: receiptContent,
    })
  }

  // Notification counts: count timeline events after user's last read receipt
  let notificationCount = 0
  const lastRead = db.select().from(readReceipts).where(and(
    eq(readReceipts.roomId, roomId),
    eq(readReceipts.userId, userId),
    eq(readReceipts.receiptType, 'm.read'),
  )).get()

  if (lastRead) {
    // The read receipt eventId is a raw ULID — count timeline events after it
    const unreadEvents = db.select().from(eventsTimeline).where(and(
      eq(eventsTimeline.roomId, roomId),
      gt(eventsTimeline.id, lastRead.eventId),
    )).all()
    notificationCount = unreadEvents.length
  }
  else if (sinceId !== null) {
    // No read receipt: count timeline events in this batch
    notificationCount = roomEvents.filter(e => e.stateKey === null).length
  }

  return {
    timeline: {
      events: roomEvents.map(formatEventWithRelations),
      limited,
      prev_batch: prevBatch,
    },
    state: {
      events: currentState.map(formatEvent),
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
  const sinceId = opts.since || null

  // Get all rooms the user is a member of
  const memberRooms = db.select({
    roomId: roomMembers.roomId,
    membership: roomMembers.membership,
    eventId: roomMembers.eventId,
  })
    .from(roomMembers)
    .where(eq(roomMembers.userId, opts.userId))
    .all()

  const joinRooms: Record<string, JoinedRoomData> = {}
  const inviteRooms: Record<string, any> = {}
  const leaveRooms: Record<string, any> = {}

  for (const mr of memberRooms) {
    if (mr.membership === 'join') {
      const roomData = buildJoinedRoomData(mr.roomId, opts.userId, sinceId)
      if (roomData) {
        joinRooms[mr.roomId] = roomData
      }
    }
    else if (mr.membership === 'invite') {
      // For incremental sync, only include if the invite is new
      if (sinceId !== null) {
        const inviteEvent = queryEventById(mr.eventId)
        if (!inviteEvent || inviteEvent.id <= sinceId) {
          continue
        }
      }

      // Get invite state (stripped state events)
      const stateRows = db.select({ eventId: currentRoomState.eventId })
        .from(currentRoomState)
        .where(eq(currentRoomState.roomId, mr.roomId))
        .all()

      const inviteEvents = []
      for (const sr of stateRows) {
        const event = db.select().from(eventsState).where(eq(eventsState.id, sr.eventId)).get()
        if (event && ['m.room.create', 'm.room.name', 'm.room.member', 'm.room.canonical_alias', 'm.room.avatar', 'm.room.join_rules'].includes(event.type)) {
          inviteEvents.push(formatEvent(event))
        }
      }

      inviteRooms[mr.roomId] = {
        invite_state: { events: inviteEvents },
      }
    }
    // For 'leave' rooms, only include in incremental sync if there are new events
    else if (mr.membership === 'leave' && sinceId !== null) {
      const newEvents = queryRoomEvents(mr.roomId, { after: sinceId, order: 'asc', limit: 100 })
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
  if (sinceId === null) {
    globalAccountData = db.select().from(accountData).where(and(
      eq(accountData.userId, opts.userId),
      eq(accountData.roomId, ''),
    )).all().map(d => ({ type: d.type, content: d.content }))
  }

  // Device one-time key counts
  const otkCount = db.select().from(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, opts.userId),
    eq(e2eeOneTimeKeys.deviceId, opts.deviceId),
    eq(e2eeOneTimeKeys.claimed, false),
  )).all().length

  // Wrap to-device message handling in transaction for atomicity
  const { toDeviceEvents } = db.transaction((tx) => {
    const device = tx.select({ lastToDeviceStreamId: devices.lastToDeviceStreamId })
      .from(devices)
      .where(and(eq(devices.userId, opts.userId), eq(devices.id, opts.deviceId)))
      .get()

    const lastDeliveredId = device?.lastToDeviceStreamId ?? 0

    // If incremental sync, the client confirmed it received the previous response
    // → safe to delete previously delivered messages
    if (sinceId !== null && lastDeliveredId > 0) {
      tx.delete(e2eeToDeviceMessages)
        .where(and(
          eq(e2eeToDeviceMessages.userId, opts.userId),
          eq(e2eeToDeviceMessages.deviceId, opts.deviceId),
          lte(e2eeToDeviceMessages.id, lastDeliveredId),
        ))
        .run()
    }

    // Fetch pending to-device messages (ordered by auto-increment id)
    const toDeviceMsgs = tx.select().from(e2eeToDeviceMessages).where(and(
      eq(e2eeToDeviceMessages.userId, opts.userId),
      eq(e2eeToDeviceMessages.deviceId, opts.deviceId),
      gt(e2eeToDeviceMessages.id, lastDeliveredId),
    )).orderBy(asc(e2eeToDeviceMessages.id)).all()

    const tdEvents = toDeviceMsgs.map(m => ({
      type: m.type,
      sender: m.sender,
      content: m.content,
    }))

    // Track the max auto-increment id we're delivering
    if (toDeviceMsgs.length > 0) {
      const maxId = toDeviceMsgs[toDeviceMsgs.length - 1]!.id
      tx.update(devices)
        .set({ lastToDeviceStreamId: maxId })
        .where(and(eq(devices.userId, opts.userId), eq(devices.id, opts.deviceId)))
        .run()
    }

    return { toDeviceEvents: tdEvents }
  })

  // Device list changes (users whose keys changed since last sync)
  let changedUsers: string[] = []
  let maxDeviceListUlid = ''
  if (sinceId !== null) {
    const changes = db.select({
      userId: e2eeDeviceListChanges.userId,
      ulid: e2eeDeviceListChanges.ulid,
    })
      .from(e2eeDeviceListChanges)
      .where(gt(e2eeDeviceListChanges.ulid, sinceId))
      .all()
    changedUsers = [...new Set(changes.map(c => c.userId))]
    changedUsers = changedUsers.filter(u => u !== opts.userId)
    if (changes.length > 0) {
      maxDeviceListUlid = changes.reduce((max, c) => c.ulid > max ? c.ulid : max, '')
    }
  }

  // next_batch must cover both event stream and device list stream
  const maxEventId = getMaxEventId()
  const nextBatch = (maxDeviceListUlid > maxEventId ? maxDeviceListUlid : maxEventId) || '0'

  // Persist next_batch to device for recovery on reconnect
  db.update(devices)
    .set({ lastSyncBatch: nextBatch })
    .where(and(eq(devices.userId, opts.userId), eq(devices.id, opts.deviceId)))
    .run()

  return {
    next_batch: nextBatch,
    rooms: {
      join: joinRooms,
      invite: inviteRooms,
      leave: leaveRooms,
    },
    account_data: { events: globalAccountData },
    presence: {
      events: getPresenceForRoommates(opts.userId).map(p => ({
        type: 'm.presence',
        sender: p.userId,
        content: {
          presence: p.state,
          last_active_ago: p.lastActiveAt ? Date.now() - p.lastActiveAt.getTime() : undefined,
          status_msg: p.statusMsg || undefined,
          currently_active: p.state === 'online',
        },
      })),
    },
    to_device: { events: toDeviceEvents },
    device_lists: {
      changed: changedUsers,
      left: [],
    },
    device_one_time_keys_count: {
      signed_curve25519: otkCount,
    },
    device_unused_fallback_key_types: db.select({ algorithm: e2eeFallbackKeys.algorithm })
      .from(e2eeFallbackKeys)
      .where(and(
        eq(e2eeFallbackKeys.userId, opts.userId),
        eq(e2eeFallbackKeys.deviceId, opts.deviceId),
      ))
      .all()
      .map(r => r.algorithm),
  }
}

export function getDeviceLastSyncBatch(userId: string, deviceId: string): string | null {
  const device = db.select({ lastSyncBatch: devices.lastSyncBatch })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()
  return device?.lastSyncBatch ?? null
}
