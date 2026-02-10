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

  // Apply edits to formatted results
  for (const idx of timelineIndices) {
    const e = events[idx]!
    const result = results[idx]!
    const latestEdit = editMap.get(`$${e.id}`)

    if (latestEdit) {
      const newContent = latestEdit.content['m.new_content'] as Record<string, unknown> | undefined
      if (newContent) {
        result.content = newContent
      }
      result.unsigned = {
        ...result.unsigned,
        'm.relations': {
          'm.replace': formatEvent(latestEdit),
        },
      }
    }
  }

  return results
}

export function formatEventList(events: any[]) {
  return events.map(formatEvent)
}
