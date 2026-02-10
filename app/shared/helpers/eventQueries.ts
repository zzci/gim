import { and, asc, desc, eq, gt, lt, max } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import { eventsState, eventsTimeline } from '@/db/schema'

export interface EventRow {
  id: string
  roomId: string
  sender: string
  type: string
  stateKey?: string | null
  content: Record<string, unknown>
  originServerTs: number
  unsigned?: Record<string, unknown> | null
}

/** Strip the leading $ from a client-provided event ID */
export function parseEventId(eventId: string): string {
  return eventId.startsWith('$') ? eventId.slice(1) : eventId
}

/** Look up an event by ID across both tables */
export function queryEventById(id: string): EventRow | null {
  const state = db.select().from(eventsState).where(eq(eventsState.id, id)).get()
  if (state)
    return { ...state, stateKey: state.stateKey }
  const timeline = db.select().from(eventsTimeline).where(eq(eventsTimeline.id, id)).get()
  if (timeline)
    return { ...timeline, stateKey: null }
  return null
}

interface RoomEventsOpts {
  after?: string
  before?: string
  order: 'asc' | 'desc'
  limit: number
}

function parseRawEventRow(r: any): EventRow {
  return {
    id: r.id,
    roomId: r.room_id,
    sender: r.sender,
    type: r.type,
    stateKey: r.state_key,
    content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    originServerTs: r.origin_server_ts,
    unsigned: r.unsigned ? (typeof r.unsigned === 'string' ? JSON.parse(r.unsigned) : r.unsigned) : null,
  }
}

/** Query events from both tables for a room using UNION ALL (single SQL query) */
export function queryRoomEvents(roomId: string, opts: RoomEventsOpts): EventRow[] {
  const dir = opts.order === 'asc' ? 'ASC' : 'DESC'

  let whereClause = 'room_id = ?'
  const params: unknown[] = [roomId]

  if (opts.after) {
    whereClause += ' AND id > ?'
    params.push(opts.after)
  }
  if (opts.before) {
    whereClause += ' AND id < ?'
    params.push(opts.before)
  }

  // UNION ALL merges both tables in a single SQL query, ordered and limited at DB level
  const query = `
    SELECT id, room_id, sender, type, state_key, content, origin_server_ts, unsigned
    FROM events_state WHERE ${whereClause}
    UNION ALL
    SELECT id, room_id, sender, type, NULL, content, origin_server_ts, unsigned
    FROM events_timeline WHERE ${whereClause}
    ORDER BY 1 ${dir}
    LIMIT ?
  `

  // Parameters duplicated for both SELECT clauses in UNION ALL
  const rows = sqlite.prepare(query).all(...params, ...params, opts.limit) as any[]
  return rows.map(parseRawEventRow)
}

/** Query only timeline events for a room */
export function queryRoomTimelineEvents(roomId: string, opts: RoomEventsOpts): EventRow[] {
  const orderFn = opts.order === 'asc' ? asc : desc
  const conds = [eq(eventsTimeline.roomId, roomId)]
  if (opts.after)
    conds.push(gt(eventsTimeline.id, opts.after))
  if (opts.before)
    conds.push(lt(eventsTimeline.id, opts.before))

  return db.select().from(eventsTimeline).where(and(...conds)).orderBy(orderFn(eventsTimeline.id)).limit(opts.limit).all().map(r => ({ ...r, stateKey: null as string | null }))
}

/** Get the max event ID across both tables */
export function getMaxEventId(): string {
  const maxState = db.select({ m: max(eventsState.id) }).from(eventsState).get()
  const maxTl = db.select({ m: max(eventsTimeline.id) }).from(eventsTimeline).get()
  const s = maxState?.m ?? ''
  const t = maxTl?.m ?? ''
  return s > t ? s : t
}
