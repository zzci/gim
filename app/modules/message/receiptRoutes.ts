import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { db } from '@/db'
import { readReceipts } from '@/db/schema'
import { getRoomId } from '@/modules/message/shared'
import { parseEventId } from '@/shared/helpers/eventQueries'

export function registerReceiptRoutes(router: Hono<AuthEnv>) {
  // POST /rooms/:roomId/receipt/:receiptType/:eventId
  router.post('/:roomId/receipt/:receiptType/:eventId', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const receiptType = c.req.param('receiptType')
    const eventId = parseEventId(c.req.param('eventId'))

    db.insert(readReceipts).values({
      roomId,
      userId: auth.userId,
      eventId,
      receiptType,
      ts: Date.now(),
    }).onConflictDoUpdate({
      target: [readReceipts.roomId, readReceipts.userId, readReceipts.receiptType],
      set: { eventId, ts: Date.now() },
    }).run()

    return c.json({})
  })

  // POST /rooms/:roomId/read_markers
  router.post('/:roomId/read_markers', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const body = await c.req.json()

    const markers: Array<{ eventId: string, receiptType: string }> = []
    if (body['m.fully_read'])
      markers.push({ eventId: parseEventId(body['m.fully_read']), receiptType: 'm.fully_read' })
    if (body['m.read'])
      markers.push({ eventId: parseEventId(body['m.read']), receiptType: 'm.read' })
    if (body['m.read.private'])
      markers.push({ eventId: parseEventId(body['m.read.private']), receiptType: 'm.read.private' })

    for (const { eventId, receiptType } of markers) {
      db.insert(readReceipts).values({
        roomId,
        userId: auth.userId,
        eventId,
        receiptType,
        ts: Date.now(),
      }).onConflictDoUpdate({
        target: [readReceipts.roomId, readReceipts.userId, readReceipts.receiptType],
        set: { eventId, ts: Date.now() },
      }).run()
    }

    return c.json({})
  })
}
