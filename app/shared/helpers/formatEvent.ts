import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { eventsTimeline } from '@/db/schema'

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
 */
export function formatEventWithRelations(e: any) {
  const result = formatEvent(e)

  // Skip relation aggregation for state events and redacted events
  if (e.stateKey !== null && e.stateKey !== undefined)
    return result
  if (result.unsigned?.redacted_because)
    return result

  // Look up latest m.replace edit for this event (only in timeline events)
  const latestEdit = db.select()
    .from(eventsTimeline)
    .where(and(
      eq(eventsTimeline.roomId, e.roomId),
      eq(eventsTimeline.type, e.type),
    ))
    .orderBy(desc(eventsTimeline.originServerTs))
    .all()
    .find((ev) => {
      const content = ev.content as Record<string, unknown>
      const rel = content['m.relates_to'] as Record<string, unknown> | undefined
      return rel?.rel_type === 'm.replace' && rel?.event_id === `$${e.id}`
    })

  if (latestEdit) {
    const editContent = latestEdit.content as Record<string, unknown>
    const newContent = editContent['m.new_content'] as Record<string, unknown> | undefined
    if (newContent) {
      result.content = newContent
    }
    result.unsigned = {
      ...result.unsigned,
      'm.relations': {
        'm.replace': formatEvent({ ...latestEdit, stateKey: null }),
      },
    }
  }

  return result
}

export function formatEventList(events: any[]) {
  return events.map(formatEvent)
}

export function formatEventListWithRelations(events: any[]) {
  return events.map(formatEventWithRelations)
}
