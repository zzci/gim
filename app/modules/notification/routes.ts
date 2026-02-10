import type { AuthEnv } from '@/shared/middleware/auth'
import { and, desc, eq, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { pushNotifications, readReceipts } from '@/db/schema'
import { queryEventById } from '@/shared/helpers/eventQueries'
import { formatEvent } from '@/shared/helpers/formatEvent'
import { authMiddleware } from '@/shared/middleware/auth'

export const notificationsRoute = new Hono<AuthEnv>()
notificationsRoute.use('/*', authMiddleware)

notificationsRoute.get('/', async (c) => {
  const auth = c.get('auth')
  const userId = auth.userId

  const fromParam = c.req.query('from')
  const limitParam = c.req.query('limit')
  const only = c.req.query('only')

  const limit = Math.min(Math.max(Number.parseInt(limitParam || '20', 10) || 20, 1), 100)

  // Query notifications in reverse chronological order (newest first)
  const conditions = [eq(pushNotifications.userId, userId)]
  if (fromParam) {
    conditions.push(lt(pushNotifications.id, fromParam))
  }

  let rows = db.select()
    .from(pushNotifications)
    .where(and(...conditions))
    .orderBy(desc(pushNotifications.id))
    .limit(limit + 1) // fetch one extra to determine next_token
    .all()

  // If only=highlight, filter to actions containing highlight tweak
  if (only === 'highlight') {
    rows = rows.filter((row) => {
      const actions = row.actions as unknown[]
      return actions.some((a) => {
        if (typeof a === 'object' && a !== null) {
          const tweak = a as Record<string, unknown>
          return tweak.set_tweak === 'highlight' && tweak.value !== false
        }
        return false
      })
    })
  }

  // Determine pagination
  let nextToken: string | undefined
  if (rows.length > limit) {
    rows = rows.slice(0, limit)
    nextToken = String(rows[rows.length - 1]!.id)
  }

  // Fetch read receipt positions per room for this user
  const roomIds = [...new Set(rows.map(r => r.roomId))]
  const receiptMap = new Map<string, string>()
  for (const roomId of roomIds) {
    const receipt = db.select({ eventId: readReceipts.eventId })
      .from(readReceipts)
      .where(and(
        eq(readReceipts.roomId, roomId),
        eq(readReceipts.userId, userId),
        eq(readReceipts.receiptType, 'm.read'),
      ))
      .get()
    if (receipt) {
      receiptMap.set(roomId, receipt.eventId)
    }
  }

  // Build response
  const result: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const event = queryEventById(row.eventId)

    if (!event)
      continue

    // Determine read status: compare event's origin_server_ts with the read receipt event's ts
    let read = row.read
    if (!read) {
      const receiptEventId = receiptMap.get(row.roomId)
      if (receiptEventId) {
        const receiptEvent = queryEventById(receiptEventId)
        if (receiptEvent && receiptEvent.originServerTs >= event.originServerTs) {
          read = true
        }
      }
    }

    result.push({
      actions: row.actions,
      event: formatEvent(event),
      read,
      room_id: row.roomId,
      ts: row.ts,
    })
  }

  const response: Record<string, unknown> = { notifications: result }
  if (nextToken) {
    response.next_token = nextToken
  }

  return c.json(response)
})
