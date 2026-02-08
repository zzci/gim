import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountData } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixForbidden, matrixNotFound } from '@/middleware/errors'

export const accountDataRoute = new Hono()

accountDataRoute.use('/*', authMiddleware)

// PUT /user/:userId/account_data/:type - set global account data
accountDataRoute.put('/:type', async (c) => {
  const auth = c.get('auth') as AuthContext
  const userId = c.req.url.includes('/user/') ? c.req.param('userId') || auth.userId : auth.userId
  const type = c.req.param('type')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set account data for other users')
  }

  const content = await c.req.json()

  await db.insert(accountData).values({
    userId,
    type,
    roomId: '',
    content,
  }).onConflictDoUpdate({
    target: [accountData.userId, accountData.type, accountData.roomId],
    set: { content },
  })

  return c.json({})
})

// GET /user/:userId/account_data/:type - get global account data
accountDataRoute.get('/:type', async (c) => {
  const auth = c.get('auth') as AuthContext
  const userId = auth.userId
  const type = c.req.param('type')

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
