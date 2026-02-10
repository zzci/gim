import { sqlite } from '@/db'
import { formatEvent } from '@/shared/helpers/formatEvent'

interface ThreadSummary {
  count: number
  latest_event: any
  current_user_participated: boolean
}

function parseRow(r: any) {
  return {
    id: r.id,
    roomId: r.room_id,
    sender: r.sender,
    type: r.type,
    stateKey: null,
    content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    originServerTs: r.origin_server_ts,
    unsigned: r.unsigned ? (typeof r.unsigned === 'string' ? JSON.parse(r.unsigned) : r.unsigned) : null,
  }
}

export function getThreadSummary(roomId: string, rootEventId: string, userId: string): ThreadSummary {
  // Count thread replies
  const countRow = sqlite.prepare(`
    SELECT COUNT(*) as cnt FROM events_timeline
    WHERE room_id = ?
      AND json_extract(content, '$.m.relates_to.rel_type') = 'm.thread'
      AND json_extract(content, '$.m.relates_to.event_id') = ?
  `).get(roomId, `$${rootEventId}`) as any

  const count = countRow?.cnt ?? 0

  // Get latest reply
  const latestRow = sqlite.prepare(`
    SELECT id, room_id, sender, type, content, origin_server_ts, unsigned
    FROM events_timeline
    WHERE room_id = ?
      AND json_extract(content, '$.m.relates_to.rel_type') = 'm.thread'
      AND json_extract(content, '$.m.relates_to.event_id') = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(roomId, `$${rootEventId}`) as any

  const latest_event = latestRow ? formatEvent(parseRow(latestRow)) : null

  // Check if current user participated
  const participatedRow = sqlite.prepare(`
    SELECT 1 FROM events_timeline
    WHERE room_id = ?
      AND sender = ?
      AND json_extract(content, '$.m.relates_to.rel_type') = 'm.thread'
      AND json_extract(content, '$.m.relates_to.event_id') = ?
    LIMIT 1
  `).get(roomId, userId, `$${rootEventId}`) as any

  const current_user_participated = !!participatedRow

  return { count, latest_event, current_user_participated }
}

export interface ThreadRootsResult {
  chunk: any[]
  next_batch?: string
}

export function getThreadRoots(
  roomId: string,
  userId: string,
  include: 'all' | 'participated',
  limit: number,
  from?: string,
): ThreadRootsResult {
  // Find all distinct thread root event IDs in this room
  let rootQuery: string
  const params: unknown[] = [roomId]

  if (include === 'participated') {
    rootQuery = `
      SELECT DISTINCT json_extract(content, '$.m.relates_to.event_id') as root_event_id
      FROM events_timeline
      WHERE room_id = ?
        AND json_extract(content, '$.m.relates_to.rel_type') = 'm.thread'
        AND json_extract(content, '$.m.relates_to.event_id') IN (
          SELECT DISTINCT json_extract(et2.content, '$.m.relates_to.event_id')
          FROM events_timeline et2
          WHERE et2.room_id = ?
            AND et2.sender = ?
            AND json_extract(et2.content, '$.m.relates_to.rel_type') = 'm.thread'
        )
    `
    params.push(roomId, userId)
  }
  else {
    rootQuery = `
      SELECT DISTINCT json_extract(content, '$.m.relates_to.event_id') as root_event_id
      FROM events_timeline
      WHERE room_id = ?
        AND json_extract(content, '$.m.relates_to.rel_type') = 'm.thread'
    `
  }

  const rootRows = sqlite.prepare(rootQuery).all(...params) as any[]

  // Extract root event IDs (strip the $ prefix for DB lookup)
  const allRootIds = rootRows
    .map(r => r.root_event_id as string)
    .filter(Boolean)
    .map(id => id.startsWith('$') ? id.slice(1) : id)

  if (allRootIds.length === 0) {
    return { chunk: [] }
  }

  // Sort root IDs descending (newest first) since IDs are ULIDs
  allRootIds.sort((a, b) => b.localeCompare(a))

  // Apply cursor-based pagination
  let paginatedIds = allRootIds
  if (from) {
    const cursorId = from.startsWith('$') ? from.slice(1) : from
    const idx = paginatedIds.findIndex(id => id === cursorId)
    if (idx >= 0) {
      paginatedIds = paginatedIds.slice(idx + 1)
    }
  }

  // Take limit + 1 to detect if there's a next page
  const pageIds = paginatedIds.slice(0, limit + 1)
  const hasMore = pageIds.length > limit
  const resultIds = hasMore ? pageIds.slice(0, limit) : pageIds

  // Fetch root events from both tables
  const chunk: any[] = []
  for (const rootId of resultIds) {
    // Try timeline first, then state
    let row = sqlite.prepare(
      'SELECT id, room_id, sender, type, content, origin_server_ts, unsigned FROM events_timeline WHERE id = ?',
    ).get(rootId) as any

    if (!row) {
      row = sqlite.prepare(
        'SELECT id, room_id, sender, type, state_key, content, origin_server_ts, unsigned FROM events_state WHERE id = ?',
      ).get(rootId) as any
    }

    if (!row)
      continue

    const parsed = parseRow(row)
    const formatted = formatEvent(parsed)

    // Attach thread summary
    const summary = getThreadSummary(roomId, rootId, userId)
    formatted.unsigned = {
      ...formatted.unsigned,
      'm.relations': {
        ...(formatted.unsigned?.['m.relations'] || {}),
        'm.thread': {
          count: summary.count,
          latest_event: summary.latest_event,
          current_user_participated: summary.current_user_participated,
        },
      },
    }

    chunk.push(formatted)
  }

  const result: ThreadRootsResult = { chunk }
  if (hasMore && resultIds.length > 0) {
    const lastId = resultIds[resultIds.length - 1]!
    result.next_batch = `$${lastId}`
  }

  return result
}
