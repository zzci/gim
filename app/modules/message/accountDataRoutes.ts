import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountData } from '@/db/schema'
import { getRoomId } from '@/modules/message/shared'
import { notifyUser } from '@/modules/sync/notifier'
import { matrixNotFound } from '@/shared/middleware/errors'
import { generateUlid } from '@/utils/tokens'

export function registerAccountDataRoutes(router: Hono<AuthEnv>) {
  // GET /rooms/:roomId/account_data/:type
  router.get('/:roomId/account_data/:type', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const dataType = c.req.param('type')

    const row = db.select().from(accountData).where(and(
      eq(accountData.userId, auth.userId),
      eq(accountData.roomId, roomId),
      eq(accountData.type, dataType),
    )).get()

    if (!row)
      return matrixNotFound(c, 'Account data not found')
    return c.json(row.content)
  })

  // PUT /rooms/:roomId/account_data/:type
  router.put('/:roomId/account_data/:type', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const dataType = c.req.param('type')
    const content = await c.req.json()

    const streamId = generateUlid()

    db.insert(accountData).values({
      userId: auth.userId,
      type: dataType,
      roomId,
      content,
      streamId,
    }).onConflictDoUpdate({
      target: [accountData.userId, accountData.type, accountData.roomId],
      set: { content, streamId },
    }).run()

    notifyUser(auth.userId)

    return c.json({})
  })
}
