import { and, asc, count, eq, gt, inArray, lte } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import {
  accountData,
  currentRoomState,
  devices,
  e2eeDeviceListChanges,
  e2eeFallbackKeys,
  e2eeOneTimeKeys,
  e2eeToDeviceMessages,
  eventsState,
  roomMembers,
  typingNotifications,
} from '@/db/schema'
import { getMaxEventId } from '@/modules/message/service'
import { getPresenceForRoommates } from '@/modules/presence/service'
import { queryEventById, queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEvent, formatEventListWithRelations } from '@/shared/helpers/formatEvent'

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
  batchData: BatchSyncData,
): JoinedRoomData | null {
  // Get timeline events (merged from both tables via UNION ALL)
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

  // Use pre-batched member counts
  const counts = batchData.memberCounts.get(roomId) ?? { joined: 0, invited: 0 }

  // Use pre-batched heroes
  const otherMembers = batchData.heroes.get(roomId) ?? []

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

  // Use pre-batched read receipts
  const roomReceipts = batchData.receipts.get(roomId) ?? []
  if (roomReceipts.length > 0) {
    const receiptContent: Record<string, Record<string, Record<string, { ts: number }>>> = {}
    for (const r of roomReceipts) {
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

  // Use pre-batched notification count
  const notificationCount = batchData.unreadCounts.get(roomId) ?? 0

  return {
    timeline: {
      events: formatEventListWithRelations(roomEvents),
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
      'm.joined_member_count': counts.joined,
      'm.invited_member_count': counts.invited,
    },
  }
}

/** Batch data pre-fetched for all rooms in a single pass */
interface BatchSyncData {
  memberCounts: Map<string, { joined: number, invited: number }>
  heroes: Map<string, string[]>
  receipts: Map<string, Array<{ userId: string, eventId: string, receiptType: string, ts: number }>>
  unreadCounts: Map<string, number>
}

function prefetchBatchSyncData(roomIds: string[], userId: string, sinceId: string | null): BatchSyncData {
  const memberCounts = new Map<string, { joined: number, invited: number }>()
  const heroes = new Map<string, string[]>()
  const receipts = new Map<string, Array<{ userId: string, eventId: string, receiptType: string, ts: number }>>()
  const unreadCounts = new Map<string, number>()

  if (roomIds.length === 0)
    return { memberCounts, heroes, receipts, unreadCounts }

  // Batch member counts using SQL COUNT with GROUP BY
  const countRows = sqlite.prepare(`
    SELECT room_id,
      SUM(CASE WHEN membership = 'join' THEN 1 ELSE 0 END) as joined,
      SUM(CASE WHEN membership = 'invite' THEN 1 ELSE 0 END) as invited
    FROM room_members
    WHERE room_id IN (${roomIds.map(() => '?').join(',')})
    GROUP BY room_id
  `).all(...roomIds) as Array<{ room_id: string, joined: number, invited: number }>

  for (const row of countRows) {
    memberCounts.set(row.room_id, { joined: row.joined, invited: row.invited })
  }

  // Batch heroes: other joined members (limit 5 per room)
  const heroRows = sqlite.prepare(`
    SELECT room_id, user_id
    FROM room_members
    WHERE room_id IN (${roomIds.map(() => '?').join(',')})
      AND membership = 'join' AND user_id != ?
  `).all(...roomIds, userId) as Array<{ room_id: string, user_id: string }>

  for (const row of heroRows) {
    const existing = heroes.get(row.room_id)
    if (existing) {
      if (existing.length < 5)
        existing.push(row.user_id)
    }
    else {
      heroes.set(row.room_id, [row.user_id])
    }
  }

  // Batch read receipts for all rooms
  const receiptRows = sqlite.prepare(`
    SELECT room_id, user_id, event_id, receipt_type, ts
    FROM read_receipts
    WHERE room_id IN (${roomIds.map(() => '?').join(',')})
  `).all(...roomIds) as Array<{ room_id: string, user_id: string, event_id: string, receipt_type: string, ts: number }>

  for (const row of receiptRows) {
    const roomReceipts = receipts.get(row.room_id)
    const entry = { userId: row.user_id, eventId: row.event_id, receiptType: row.receipt_type, ts: row.ts }
    if (roomReceipts)
      roomReceipts.push(entry)
    else receipts.set(row.room_id, [entry])
  }

  // Batch unread notification counts: single query with GROUP BY
  // First get user's read receipt per room, then count unread timeline events
  const unreadRows = sqlite.prepare(`
    SELECT et.room_id, COUNT(*) as cnt
    FROM events_timeline et
    LEFT JOIN read_receipts rr
      ON rr.room_id = et.room_id AND rr.user_id = ? AND rr.receipt_type = 'm.read'
    WHERE et.room_id IN (${roomIds.map(() => '?').join(',')})
      AND (rr.event_id IS NULL OR et.id > rr.event_id)
    GROUP BY et.room_id
  `).all(userId, ...roomIds) as Array<{ room_id: string, cnt: number }>

  for (const row of unreadRows) {
    unreadCounts.set(row.room_id, row.cnt)
  }

  // For rooms without a read receipt in incremental sync, count timeline events in batch
  if (sinceId !== null) {
    for (const roomId of roomIds) {
      if (!unreadCounts.has(roomId)) {
        // Will be set to 0 or overridden per-room based on actual events found
        unreadCounts.set(roomId, 0)
      }
    }
  }

  return { memberCounts, heroes, receipts, unreadCounts }
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

  // Pre-fetch batch data for all joined rooms
  const joinedRoomIds = memberRooms.filter(mr => mr.membership === 'join').map(mr => mr.roomId)
  const batchData = prefetchBatchSyncData(joinedRoomIds, opts.userId, sinceId)

  for (const mr of memberRooms) {
    if (mr.membership === 'join') {
      const roomData = buildJoinedRoomData(mr.roomId, opts.userId, sinceId, batchData)
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

      const inviteStateIds = stateRows.map(sr => sr.eventId)
      const inviteEvents = inviteStateIds.length > 0
        ? db.select().from(eventsState).where(inArray(eventsState.id, inviteStateIds)).all().filter(event => ['m.room.create', 'm.room.name', 'm.room.member', 'm.room.canonical_alias', 'm.room.avatar', 'm.room.join_rules'].includes(event.type)).map(formatEvent)
        : []

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

  // Device one-time key counts — use SQL COUNT instead of .all().length
  const otkResult = db.select({ cnt: count() }).from(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, opts.userId),
    eq(e2eeOneTimeKeys.deviceId, opts.deviceId),
    eq(e2eeOneTimeKeys.claimed, false),
  )).get()
  const otkCount = otkResult?.cnt ?? 0

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
