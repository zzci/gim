import { sqlite } from '@/db'

export function formatEvent(e: any) {
  const result: any = {
    event_id: `$${e.id}`,
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

/**
 * Format an event and aggregate m.replace relations.
 * If the event has been edited (via m.replace), the returned event will have:
 * - content replaced with m.new_content from the latest edit
 * - unsigned.m.relations.m.replace pointing to the latest edit event
 *
 * NOTE: For batch processing, prefer formatEventListWithRelations which uses
 * a single SQL query instead of N+1 queries.
 */
export function formatEventWithRelations(e: any) {
  return formatEventListWithRelations([e])[0]!
}

/**
 * Batch format events with relation aggregation using a single SQL query.
 * Replaces the N+1 pattern of querying edits per event.
 */
export function formatEventListWithRelations(events: any[]) {
  // Separate state/redacted events (no relation processing needed) from timeline events
  const results: any[] = []
  const timelineIndices: number[] = []
  const timelineEvents: any[] = []

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const result = formatEvent(e)
    results.push(result)

    const isState = e.stateKey !== null && e.stateKey !== undefined
    const isRedacted = result.unsigned?.redacted_because
    if (!isState && !isRedacted) {
      timelineIndices.push(i)
      timelineEvents.push(e)
    }
  }

  if (timelineEvents.length === 0)
    return results

  // Collect event IDs that need edit lookup, grouped by roomId
  const eventIdsByRoom = new Map<string, string[]>()
  for (const e of timelineEvents) {
    const ids = eventIdsByRoom.get(e.roomId)
    if (ids)
      ids.push(`$${e.id}`)
    else eventIdsByRoom.set(e.roomId, [`$${e.id}`])
  }

  // Batch query: find all m.replace edits targeting our event IDs
  // Uses SQLite json_extract to filter directly in SQL instead of fetching all events
  const editMap = new Map<string, any>() // target event_id → latest edit row

  for (const [roomId, targetIds] of eventIdsByRoom) {
    const placeholders = targetIds.map(() => '?').join(',')
    const query = `
      SELECT id, room_id, sender, type, content, origin_server_ts, unsigned
      FROM events_timeline
      WHERE room_id = ?
        AND json_extract(content, '$."m.relates_to".rel_type') = 'm.replace'
        AND json_extract(content, '$."m.relates_to".event_id') IN (${placeholders})
      ORDER BY origin_server_ts DESC
    `
    const rows = sqlite.prepare(query).all(roomId, ...targetIds) as any[]

    for (const row of rows) {
      const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
      const targetEventId = content['m.relates_to']?.event_id
      if (targetEventId && !editMap.has(targetEventId)) {
        // First match is the latest edit (ordered by origin_server_ts DESC)
        editMap.set(targetEventId, {
          id: row.id,
          roomId: row.room_id,
          sender: row.sender,
          type: row.type,
          content,
          originServerTs: row.origin_server_ts,
          unsigned: row.unsigned ? (typeof row.unsigned === 'string' ? JSON.parse(row.unsigned) : row.unsigned) : null,
          stateKey: null,
        })
      }
    }
  }

  // Batch query: find thread reply counts and latest reply for events that are thread roots
  const threadMap = new Map<string, { count: number, latest_event: any }>()

  for (const [roomId, targetIds] of eventIdsByRoom) {
    const placeholders = targetIds.map(() => '?').join(',')

    // Get reply counts per thread root
    const countQuery = `
      SELECT json_extract(content, '$."m.relates_to".event_id') as root_id, COUNT(*) as cnt
      FROM events_timeline
      WHERE room_id = ?
        AND json_extract(content, '$."m.relates_to".rel_type') = 'm.thread'
        AND json_extract(content, '$."m.relates_to".event_id') IN (${placeholders})
      GROUP BY root_id
    `
    const countRows = sqlite.prepare(countQuery).all(roomId, ...targetIds) as any[]

    for (const row of countRows) {
      const rootId = row.root_id as string
      if (!rootId)
        continue

      // Get latest reply for this thread root
      const latestQuery = `
        SELECT id, room_id, sender, type, content, origin_server_ts, unsigned
        FROM events_timeline
        WHERE room_id = ?
          AND json_extract(content, '$."m.relates_to".rel_type') = 'm.thread'
          AND json_extract(content, '$."m.relates_to".event_id') = ?
        ORDER BY id DESC
        LIMIT 1
      `
      const latestRow = sqlite.prepare(latestQuery).get(roomId, rootId) as any
      let latestEvent = null
      if (latestRow) {
        const content = typeof latestRow.content === 'string' ? JSON.parse(latestRow.content) : latestRow.content
        const unsigned = latestRow.unsigned ? (typeof latestRow.unsigned === 'string' ? JSON.parse(latestRow.unsigned) : latestRow.unsigned) : null
        latestEvent = formatEvent({
          id: latestRow.id,
          roomId: latestRow.room_id,
          sender: latestRow.sender,
          type: latestRow.type,
          content,
          originServerTs: latestRow.origin_server_ts,
          unsigned,
          stateKey: null,
        })
      }

      threadMap.set(rootId, { count: row.cnt, latest_event: latestEvent })
    }
  }

  // Apply edits and thread summaries to formatted results
  for (const idx of timelineIndices) {
    const e = events[idx]!
    const result = results[idx]!
    const latestEdit = editMap.get(`$${e.id}`)
    const threadInfo = threadMap.get(`$${e.id}`)

    const relations: Record<string, any> = {}

    if (latestEdit) {
      const newContent = latestEdit.content['m.new_content'] as Record<string, unknown> | undefined
      if (newContent) {
        result.content = newContent
      }
      relations['m.replace'] = formatEvent(latestEdit)
    }

    if (threadInfo) {
      relations['m.thread'] = {
        count: threadInfo.count,
        latest_event: threadInfo.latest_event,
        current_user_participated: false,
      }
    }

    if (Object.keys(relations).length > 0) {
      result.unsigned = {
        ...result.unsigned,
        'm.relations': relations,
      }
    }
  }

  return results
}

export function formatEventList(events: any[]) {
  return events.map(formatEvent)
}
