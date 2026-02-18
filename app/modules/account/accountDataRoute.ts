import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountData } from '@/db/schema'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { generateUlid } from '@/utils/tokens'

export const accountDataRoute = new Hono<AuthEnv>()
accountDataRoute.use('/*', authMiddleware)
const BACKUP_DISABLED_TYPE = 'm.org.matrix.custom.backup_disabled'

accountDataRoute.put('/:type', async (c) => {
  const auth = c.get('auth')
  const userId = c.req.url.includes('/user/') ? c.req.param('userId') || auth.userId : auth.userId
  const type = c.req.param('type')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set account data for other users')
  }

  const content = await c.req.json()

  const streamId = generateUlid()

  await db.insert(accountData).values({
    userId,
    type,
    roomId: '',
    content,
    streamId,
  }).onConflictDoUpdate({
    target: [accountData.userId, accountData.type, accountData.roomId],
    set: { content, streamId },
  })

  notifyUser(userId)

  return c.json({})
})

accountDataRoute.get('/:type', async (c) => {
  const auth = c.get('auth')
  const userId = auth.userId
  const type = c.req.param('type')

  if (type === BACKUP_DISABLED_TYPE) {
    return c.json({ disabled: true })
  }

  const result = await db.select()
    .from(accountData)
    .where(and(
      eq(accountData.userId, userId),
      eq(accountData.type, type),
      eq(accountData.roomId, ''),
    ))
    .limit(1)

  if (!result[0]) {
    return matrixNotFound(c, 'Account data not found')
  }

  return c.json(result[0].content)
})
