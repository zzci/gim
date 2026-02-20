import { sqlite } from '@/db'
import { getMaxEventId, queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEvent, formatEventListWithRelations } from '@/shared/helpers/formatEvent'
import { collectGlobalAccountData } from './collectors/accountData'
import { collectDeviceListChanges, collectE2eeKeyCounts } from './collectors/deviceLists'
import { collectToDeviceMessages } from './collectors/toDevice'

interface SlidingSyncList {
  ranges: [number, number][]
  required_state?: [string, string][]
  timeline_limit?: number
  filters?: {
    is_dm?: boolean
    room_types?: string[]
  }
}

interface SlidingSyncRoomSubscription {
  required_state?: [string, string][]
  timeline_limit?: number
}

interface SlidingSyncExtensions {
  to_device?: { enabled?: boolean, since?: string }
  e2ee?: { enabled?: boolean }
  account_data?: { enabled?: boolean }
}

export interface SlidingSyncRequest {
  lists?: Record<string, SlidingSyncList>
  room_subscriptions?: Record<string, SlidingSyncRoomSubscription>
  extensions?: SlidingSyncExtensions
}

interface SlidingSyncOp {
  op: string
  range: [number, number]
  room_ids: string[]
}

interface SlidingSyncListResponse {
  count: number
  ops: SlidingSyncOp[]
}

interface SlidingSyncRoomResponse {
  name?: string
  required_state: any[]
  timeline: any[]
  notification_count: number
  highlight_count: number
  initial: boolean
  joined_count?: number
  invited_count?: number
}

export interface SlidingSyncResponse {
  pos: string
  lists: Record<string, SlidingSyncListResponse>
  rooms: Record<string, SlidingSyncRoomResponse>
  extensions: Record<string, any>
}

interface RoomSortEntry {
  roomId: string
  latestEventId: string
}

function getUserJoinedRoomsSorted(userId: string): RoomSortEntry[] {
  const rows = sqlite.prepare(`
    SELECT rm.room_id,
      COALESCE(
        (SELECT MAX(id) FROM (
          SELECT id FROM events_state WHERE room_id = rm.room_id
          UNION ALL
          SELECT id FROM events_timeline WHERE room_id = rm.room_id
        )),
        ''
      ) as latest_event_id
    FROM room_members rm
    WHERE rm.user_id = ? AND rm.membership = 'join'
    ORDER BY latest_event_id DESC
  `).all(userId) as Array<{ room_id: string, latest_event_id: string }>

  return rows.map(r => ({ roomId: r.room_id, latestEventId: r.latest_event_id }))
}

function applyFilters(
  roomEntries: RoomSortEntry[],
  filters?: { is_dm?: boolean, room_types?: string[] },
): RoomSortEntry[] {
  if (!filters)
    return roomEntries

  let result = roomEntries

  if (filters.is_dm !== undefined) {
    const roomIds = result.map(r => r.roomId)
    if (roomIds.length === 0)
      return []

    const placeholders = roomIds.map(() => '?').join(',')
    const dmRows = sqlite.prepare(`
      SELECT id, is_direct FROM rooms WHERE id IN (${placeholders})
    `).all(...roomIds) as Array<{ id: string, is_direct: number }>

    const dmSet = new Set<string>()
    for (const row of dmRows) {
      if (row.is_direct)
        dmSet.add(row.id)
    }

    result = result.filter(r => filters.is_dm ? dmSet.has(r.roomId) : !dmSet.has(r.roomId))
  }

  if (filters.room_types && filters.room_types.length > 0) {
    const roomIds = result.map(r => r.roomId)
    if (roomIds.length === 0)
      return []

    const placeholders = roomIds.map(() => '?').join(',')
    const createRows = sqlite.prepare(`
      SELECT crs.room_id, es.content
      FROM current_room_state crs
      JOIN events_state es ON es.id = crs.event_id
      WHERE crs.room_id IN (${placeholders})
        AND crs.type = 'm.room.create'
        AND crs.state_key = ''
    `).all(...roomIds) as Array<{ room_id: string, content: string }>

    const roomTypeMap = new Map<string, string | null>()
    for (const row of createRows) {
      const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
      roomTypeMap.set(row.room_id, content.type ?? null)
    }

    result = result.filter((r) => {
      const roomType = roomTypeMap.get(r.roomId) ?? null
      return filters.room_types!.includes(roomType as string)
    })
  }

  return result
}

function getRoomName(roomId: string, userId: string): string | undefined {
  // Try m.room.name state
  const nameRow = sqlite.prepare(`
    SELECT es.content
    FROM current_room_state crs
    JOIN events_state es ON es.id = crs.event_id
    WHERE crs.room_id = ? AND crs.type = 'm.room.name' AND crs.state_key = ''
  `).get(roomId) as { content: string } | null

  if (nameRow) {
    const content = typeof nameRow.content === 'string' ? JSON.parse(nameRow.content) : nameRow.content
    if (content.name)
      return content.name
  }

  // Calculate from heroes (other joined members)
  const heroes = sqlite.prepare(`
    SELECT user_id FROM room_members
    WHERE room_id = ? AND membership = 'join' AND user_id != ?
    LIMIT 5
  `).all(roomId, userId) as Array<{ user_id: string }>

  if (heroes.length > 0) {
    return heroes.map(h => h.user_id).join(', ')
  }

  return undefined
}

function getRoomRequiredState(
  roomId: string,
  requiredState?: [string, string][],
): any[] {
  if (!requiredState || requiredState.length === 0)
    return []

  const results: any[] = []

  for (const [eventType, stateKey] of requiredState) {
    if (eventType === '*' && stateKey === '*') {
      // All state events
      const rows = sqlite.prepare(`
        SELECT es.*
        FROM current_room_state crs
        JOIN events_state es ON es.id = crs.event_id
        WHERE crs.room_id = ?
      `).all(roomId) as any[]
      for (const row of rows) {
        results.push(parseStateRow(row))
      }
    }
    else if (stateKey === '*') {
      // All state keys for this type
      const rows = sqlite.prepare(`
        SELECT es.*
        FROM current_room_state crs
        JOIN events_state es ON es.id = crs.event_id
        WHERE crs.room_id = ? AND crs.type = ?
      `).all(roomId, eventType) as any[]
      for (const row of rows) {
        results.push(parseStateRow(row))
      }
    }
    else {
      const row = sqlite.prepare(`
        SELECT es.*
        FROM current_room_state crs
        JOIN events_state es ON es.id = crs.event_id
        WHERE crs.room_id = ? AND crs.type = ? AND crs.state_key = ?
      `).get(roomId, eventType, stateKey) as any | null
      if (row) {
        results.push(parseStateRow(row))
      }
    }
  }

  return results
}

function parseStateRow(row: any): any {
  return {
    id: row.id,
    roomId: row.room_id,
    sender: row.sender,
    type: row.type,
    stateKey: row.state_key,
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    originServerTs: row.origin_server_ts,
    unsigned: row.unsigned ? (typeof row.unsigned === 'string' ? JSON.parse(row.unsigned) : row.unsigned) : null,
  }
}

function getRoomTimeline(roomId: string, limit: number, after?: string): any[] {
  if (limit <= 0)
    return []

  if (after) {
    // Incremental updates should mirror /sync semantics and include both state + timeline events.
    return queryRoomEvents(roomId, { after, order: 'asc', limit })
  }

  const events = queryRoomEvents(roomId, { order: 'desc', limit })
  events.reverse()
  return events
}

function getRoomNotificationCount(roomId: string, userId: string): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) as cnt
    FROM events_timeline et
    LEFT JOIN read_receipts rr
      ON rr.room_id = et.room_id AND rr.user_id = ? AND rr.receipt_type = 'm.read'
    WHERE et.room_id = ?
      AND (rr.event_id IS NULL OR et.id > rr.event_id)
  `).get(userId, roomId) as { cnt: number } | null

  return row?.cnt ?? 0
}

function getRoomMemberCounts(roomId: string): { joined: number, invited: number } {
  const row = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN membership = 'join' THEN 1 ELSE 0 END) as joined,
      SUM(CASE WHEN membership = 'invite' THEN 1 ELSE 0 END) as invited
    FROM room_members
    WHERE room_id = ?
  `).get(roomId) as { joined: number, invited: number } | null

  return { joined: row?.joined ?? 0, invited: row?.invited ?? 0 }
}

function buildRoomResponse(
  roomId: string,
  userId: string,
  opts: { required_state?: [string, string][], timeline_limit?: number },
  since?: string,
): SlidingSyncRoomResponse {
  const timelineLimit = opts.timeline_limit ?? 10
  const timeline = getRoomTimeline(roomId, timelineLimit, since)
  const requiredState = getRoomRequiredState(roomId, opts.required_state)
  const name = getRoomName(roomId, userId)
  const notificationCount = getRoomNotificationCount(roomId, userId)
  const counts = getRoomMemberCounts(roomId)

  return {
    name,
    required_state: requiredState.map(formatEvent),
    timeline: formatEventListWithRelations(timeline),
    notification_count: notificationCount,
    highlight_count: 0,
    initial: !since,
    joined_count: counts.joined,
    invited_count: counts.invited,
  }
}

function hasRoomChanges(roomId: string, since: string): boolean {
  const row = sqlite.prepare(`
    SELECT 1 FROM (
      SELECT id FROM events_state WHERE room_id = ? AND id > ?
      UNION ALL
      SELECT id FROM events_timeline WHERE room_id = ? AND id > ?
    ) LIMIT 1
  `).get(roomId, since, roomId, since)

  return !!row
}

export function buildSlidingSyncResponse(
  userId: string,
  deviceId: string,
  isTrustedDevice: boolean,
  body: SlidingSyncRequest,
  since?: string,
): SlidingSyncResponse {
  const allRooms = isTrustedDevice ? getUserJoinedRoomsSorted(userId) : []

  const listsResponse: Record<string, SlidingSyncListResponse> = {}
  const roomsResponse: Record<string, SlidingSyncRoomResponse> = {}
  const roomsToInclude = new Set<string>()

  // Process lists
  if (body.lists) {
    for (const [listName, listDef] of Object.entries(body.lists)) {
      const filtered = applyFilters(allRooms, listDef.filters)
      const totalCount = filtered.length

      const ops: SlidingSyncOp[] = []

      for (const range of listDef.ranges) {
        const [start, end] = range
        const sliced = filtered.slice(start, end + 1)
        const roomIds = sliced.map(r => r.roomId)

        ops.push({
          op: 'SYNC',
          range: [start, end],
          room_ids: roomIds,
        })

        for (const roomId of roomIds) {
          roomsToInclude.add(roomId)
        }
      }

      listsResponse[listName] = isTrustedDevice
        ? { count: totalCount, ops }
        : { count: 0, ops: [] }
    }
  }

  // Add room subscriptions (only for rooms the user is actually joined to)
  if (isTrustedDevice && body.room_subscriptions) {
    const userRoomIds = new Set(allRooms.map(r => r.roomId))
    for (const roomId of Object.keys(body.room_subscriptions)) {
      if (userRoomIds.has(roomId)) {
        roomsToInclude.add(roomId)
      }
    }
  }

  // Build room data for all rooms that need to be included
  for (const roomId of roomsToInclude) {
    // For incremental sync, only include rooms with changes
    if (since && !hasRoomChanges(roomId, since)) {
      continue
    }

    // Determine required_state and timeline_limit from list or subscription
    let requiredState: [string, string][] | undefined
    let timelineLimit: number | undefined

    // Check room_subscriptions first (takes priority)
    if (body.room_subscriptions?.[roomId]) {
      requiredState = body.room_subscriptions[roomId]!.required_state
      timelineLimit = body.room_subscriptions[roomId]!.timeline_limit
    }

    // Fall back to list settings
    if (requiredState === undefined && body.lists) {
      for (const listDef of Object.values(body.lists)) {
        if (requiredState === undefined) {
          requiredState = listDef.required_state
        }
        if (timelineLimit === undefined) {
          timelineLimit = listDef.timeline_limit
        }
      }
    }

    roomsResponse[roomId] = buildRoomResponse(
      roomId,
      userId,
      { required_state: requiredState, timeline_limit: timelineLimit },
      since,
    )
  }

  // Extensions — use shared collectors
  const extensions: Record<string, any> = {}

  if (body.extensions?.to_device?.enabled) {
    const toDeviceSince = body.extensions.to_device.since
    const result = collectToDeviceMessages(userId, deviceId, isTrustedDevice, !!toDeviceSince)
    extensions.to_device = {
      events: result.events,
      next_batch: result.maxDeliveredId > 0
        ? String(result.maxDeliveredId)
        : (toDeviceSince || '0'),
    }
  }

  let maxDeviceListUlid = ''
  if (body.extensions?.e2ee?.enabled) {
    const deviceLists = collectDeviceListChanges(userId, isTrustedDevice, since || null)
    const keyCounts = collectE2eeKeyCounts(userId, deviceId)
    maxDeviceListUlid = deviceLists.maxUlid
    extensions.e2ee = {
      device_one_time_keys_count: {
        signed_curve25519: keyCounts.otkCount,
      },
      device_unused_fallback_key_types: keyCounts.fallbackKeyAlgorithms,
      device_lists: {
        changed: deviceLists.changed,
        left: deviceLists.left,
      },
    }
  }

  if (body.extensions?.account_data?.enabled) {
    const result = collectGlobalAccountData(userId, isTrustedDevice, since || null)
    extensions.account_data = {
      global: result.events,
    }
  }

  // Position token — advance past all streams so incremental sync doesn't re-deliver
  let pos = getMaxEventId() || '0'
  if (maxDeviceListUlid && maxDeviceListUlid > pos)
    pos = maxDeviceListUlid

  return {
    pos,
    lists: listsResponse,
    rooms: roomsResponse,
    extensions,
  }
}

export function hasSlidingSyncChanges(response: SlidingSyncResponse): boolean {
  if (Object.keys(response.rooms).length > 0)
    return true
  if (response.extensions.to_device?.events?.length > 0)
    return true
  if (response.extensions.e2ee?.device_lists?.changed?.length > 0)
    return true
  if (response.extensions.account_data?.global?.length > 0)
    return true
  return false
}
