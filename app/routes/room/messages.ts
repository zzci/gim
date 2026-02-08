import { Hono } from 'hono'
import { eq, and, gt, lt, asc, desc } from 'drizzle-orm'
import { db } from '@/db'
import { events } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixForbidden } from '@/middleware/errors'
import { getRoomMembership } from '@/services/rooms'

export const messagesRoute = new Hono()

messagesRoute.use('/*', authMiddleware)

// GET /rooms/:roomId/messages
messagesRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const roomId = c.req.param('roomId') || ''
  const from = c.req.query('from')
  const to = c.req.query('to')
  const dir = c.req.query('dir') || 'b'
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 100)

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const fromOrder = from ? Number.parseInt(from) : undefined
  const toOrder = to ? Number.parseInt(to) : undefined

  let query = db.select()
    .from(events)
    .where(eq(events.roomId, roomId))
    .$dynamic()

  if (dir === 'b') {
    // Backwards
    if (fromOrder !== undefined) {
      query = query.where(and(eq(events.roomId, roomId), lt(events.streamOrder, fromOrder)))
    }
    if (toOrder !== undefined) {
      query = query.where(and(eq(events.roomId, roomId), gt(events.streamOrder, toOrder)))
    }
    query = query.orderBy(desc(events.streamOrder))
  }
  else {
    // Forwards
    if (fromOrder !== undefined) {
      query = query.where(and(eq(events.roomId, roomId), gt(events.streamOrder, fromOrder)))
    }
    if (toOrder !== undefined) {
      query = query.where(and(eq(events.roomId, roomId), lt(events.streamOrder, toOrder)))
    }
    query = query.orderBy(asc(events.streamOrder))
  }

  const rows = query.limit(limit).all()

  const chunk = rows.map(e => ({
    event_id: e.id,
    room_id: e.roomId,
    sender: e.sender,
    type: e.type,
    content: e.content,
    origin_server_ts: e.originServerTs,
    ...(e.stateKey !== null ? { state_key: e.stateKey } : {}),
  }))

  const startToken = from || (rows.length > 0 ? String(rows[0]!.streamOrder) : '0')
  const endToken = rows.length > 0 ? String(rows[rows.length - 1]!.streamOrder) : startToken

  return c.json({
    start: startToken,
    end: endToken,
    chunk,
  })
})
