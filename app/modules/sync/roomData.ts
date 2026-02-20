import { eq } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import {
  roomMembers,
} from '@/db/schema'
import { getAllStateEventIds, getStateEventsByIds } from '@/models/roomState'
import { queryEventById, queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEvent, formatEventListWithRelations } from '@/shared/helpers/formatEvent'

const DEFAULT_TIMELINE_LIMIT = 10

const INVITE_STATE_TYPES = [
  'm.room.create',
  'm.room.name',
  'm.room.member',
  'm.room.canonical_alias',
  'm.room.avatar',
  'm.room.join_rules',
]

// --- Types ---

export interface JoinedRoomData {
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

export interface BatchSyncData {
  memberCounts: Map<string, { joined: number, invited: number }>
  heroes: Map<string, string[]>
  receipts: Map<string, Array<{ userId: string, eventId: string, receiptType: string, ts: number }>>
  unreadCounts: Map<string, number>
  typing: Map<string, string[]>
  roomAccountData: Map<string, Array<{ type: string, content: Record<string, unknown> }>>
}

interface MembershipRow {
  roomId: string
  membership: string
  eventId: string
}

// --- Functions ---

export function getUserRoomMemberships(userId: string, isTrusted: boolean): MembershipRow[] {
  if (!isTrusted)
    return []

  return db.select({
    roomId: roomMembers.roomId,
    membership: roomMembers.membership,
    eventId: roomMembers.eventId,
  })
    .from(roomMembers)
    .where(eq(roomMembers.userId, userId))
    .all()
}

export function prefetchBatchSyncData(roomIds: string[], userId: string, sinceId: string | null, sinceStreamId: string | null = null): BatchSyncData {
  const memberCounts = new Map<string, { joined: number, invited: number }>()
  const heroes = new Map<string, string[]>()
  const receipts = new Map<string, Array<{ userId: string, eventId: string, receiptType: string, ts: number }>>()
  const unreadCounts = new Map<string, number>()
  const typing = new Map<string, string[]>()
  const roomAccountData = new Map<string, Array<{ type: string, content: Record<string, unknown> }>>()

  if (roomIds.length === 0)
    return { memberCounts, heroes, receipts, unreadCounts, typing, roomAccountData }

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
        unreadCounts.set(roomId, 0)
      }
    }
  }

  // Batch typing notifications (expired entries already cleaned before this call)
  const typingRows = sqlite.prepare(`
    SELECT room_id, user_id
    FROM typing_notifications
    WHERE room_id IN (${roomIds.map(() => '?').join(',')})
  `).all(...roomIds) as Array<{ room_id: string, user_id: string }>

  for (const row of typingRows) {
    const existing = typing.get(row.room_id)
    if (existing)
      existing.push(row.user_id)
    else
      typing.set(row.room_id, [row.user_id])
  }

  // Batch room account data (filter by stream_id for incremental sync)
  const accountDataQuery = sinceStreamId
    ? sqlite.prepare(`
        SELECT user_id, type, room_id, content
        FROM account_data
        WHERE user_id = ? AND room_id IN (${roomIds.map(() => '?').join(',')}) AND stream_id > ?
      `)
    : sqlite.prepare(`
        SELECT user_id, type, room_id, content
        FROM account_data
        WHERE user_id = ? AND room_id IN (${roomIds.map(() => '?').join(',')})
      `)
  const accountDataRows = (sinceStreamId
    ? accountDataQuery.all(userId, ...roomIds, sinceStreamId)
    : accountDataQuery.all(userId, ...roomIds)
  ) as Array<{ user_id: string, type: string, room_id: string, content: string }>

  for (const row of accountDataRows) {
    const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
    const entry = { type: row.type, content }
    const existing = roomAccountData.get(row.room_id)
    if (existing)
      existing.push(entry)
    else
      roomAccountData.set(row.room_id, [entry])
  }

  return { memberCounts, heroes, receipts, unreadCounts, typing, roomAccountData }
}

export function buildJoinedRoomData(
  roomId: string,
  userId: string,
  sinceId: string | null,
  batchData: BatchSyncData,
): JoinedRoomData | null {
  let roomEvents: any[]
  let limited = false
  let prevBatch = ''

  if (sinceId === null) {
    roomEvents = queryRoomEvents(roomId, { order: 'desc', limit: DEFAULT_TIMELINE_LIMIT })
    roomEvents.reverse()

    if (roomEvents.length === DEFAULT_TIMELINE_LIMIT) {
      limited = true
    }
    prevBatch = roomEvents.length > 0 ? roomEvents[0]!.id : ''
  }
  else {
    roomEvents = queryRoomEvents(roomId, { after: sinceId, order: 'asc', limit: DEFAULT_TIMELINE_LIMIT })

    if (roomEvents.length === DEFAULT_TIMELINE_LIMIT) {
      const totalNew = queryRoomEvents(roomId, { after: sinceId, order: 'asc', limit: DEFAULT_TIMELINE_LIMIT + 1 })
      if (totalNew.length > DEFAULT_TIMELINE_LIMIT) {
        limited = true
      }
    }

    prevBatch = sinceId

    if (roomEvents.length === 0) {
      return null
    }
  }

  // Get state events
  let currentState: any[] = []
  if (sinceId === null || limited) {
    const allStateIds = getAllStateEventIds(roomId)
    const timelineIds = new Set(roomEvents.map(e => e.id))
    const stateEventIds = allStateIds.filter(id => !timelineIds.has(id))
    if (stateEventIds.length > 0) {
      currentState = getStateEventsByIds(stateEventIds)
    }
  }

  const roomAccountDataEntries = batchData.roomAccountData.get(roomId) ?? []
  const counts = batchData.memberCounts.get(roomId) ?? { joined: 0, invited: 0 }
  const otherMembers = batchData.heroes.get(roomId) ?? []

  // Ephemeral events: typing + receipts
  const ephemeralEvents: any[] = []

  const typerIds = batchData.typing.get(roomId)
  if (typerIds && typerIds.length > 0) {
    ephemeralEvents.push({
      type: 'm.typing',
      content: { user_ids: typerIds },
    })
  }

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
      events: roomAccountDataEntries.map(d => ({
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

export function buildInviteRoomData(
  roomId: string,
  inviteEventId: string,
  sinceId: string | null,
): { invite_state: { events: any[] } } | null {
  // For incremental sync, only include if the invite is new
  if (sinceId !== null) {
    const inviteEvent = queryEventById(inviteEventId)
    if (!inviteEvent || inviteEvent.id <= sinceId) {
      return null
    }
  }

  // Get invite state (stripped state events)
  const inviteStateIds = getAllStateEventIds(roomId)
  const inviteEvents = inviteStateIds.length > 0
    ? getStateEventsByIds(inviteStateIds).filter(event => INVITE_STATE_TYPES.includes(event.type)).map(formatEvent)
    : []

  return { invite_state: { events: inviteEvents } }
}

export function buildLeaveRoomData(
  roomId: string,
  sinceId: string | null,
): { timeline: { events: any[] }, state: { events: any[] } } | null {
  // Only include in incremental sync if there are new events
  if (sinceId === null) {
    return null
  }

  const newEvents = queryRoomEvents(roomId, { after: sinceId, order: 'asc', limit: 100 })
  if (newEvents.length === 0) {
    return null
  }

  return {
    timeline: { events: newEvents.map(formatEvent) },
    state: { events: [] },
  }
}
