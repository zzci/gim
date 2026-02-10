import { and, asc, desc, eq, gt, lt, max } from 'drizzle-orm'
import { db } from '@/db'
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

/** Query events from both tables for a room, merged and sorted by id (ULID) */
export function queryRoomEvents(roomId: string, opts: RoomEventsOpts): EventRow[] {
  const orderFn = opts.order === 'asc' ? asc : desc

  // Build conditions for state events
  const stateConds = [eq(eventsState.roomId, roomId)]
  if (opts.after)
    stateConds.push(gt(eventsState.id, opts.after))
  if (opts.before)
    stateConds.push(lt(eventsState.id, opts.before))

  // Build conditions for timeline events
  const tlConds = [eq(eventsTimeline.roomId, roomId)]
  if (opts.after)
    tlConds.push(gt(eventsTimeline.id, opts.after))
  if (opts.before)
    tlConds.push(lt(eventsTimeline.id, opts.before))

  const stateRows = db.select().from(eventsState).where(and(...stateConds)).orderBy(orderFn(eventsState.id)).limit(opts.limit).all().map(r => ({ ...r, stateKey: r.stateKey as string | null }))

  const tlRows = db.select().from(eventsTimeline).where(and(...tlConds)).orderBy(orderFn(eventsTimeline.id)).limit(opts.limit).all().map(r => ({ ...r, stateKey: null as string | null }))

  // Merge and sort
  const all = [...stateRows, ...tlRows]
  if (opts.order === 'asc') {
    all.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
  else {
    all.sort((a, b) => a.id > b.id ? -1 : a.id < b.id ? 1 : 0)
  }

  return all.slice(0, opts.limit)
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
