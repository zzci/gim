import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountFilters } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixNotFound } from '@/shared/middleware/errors'

export const userFilterRoute = new Hono<AuthEnv>()
userFilterRoute.use('/*', authMiddleware)

userFilterRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const json = JSON.stringify(body)

  const existing = db.select({ id: accountFilters.id, filterJson: accountFilters.filterJson })
    .from(accountFilters)
    .where(eq(accountFilters.userId, auth.userId))
    .all()
    .find(r => JSON.stringify(r.filterJson) === json)

  if (existing) {
    return c.json({ filter_id: existing.id })
  }

  const row = db.insert(accountFilters).values({
    userId: auth.userId,
    filterJson: body,
  }).returning({ id: accountFilters.id }).get()

  return c.json({ filter_id: row.id })
})

userFilterRoute.get('/:filterId', async (c) => {
  const auth = c.get('auth')
  const filterId = c.req.param('filterId')

  const result = await db.select()
    .from(accountFilters)
    .where(eq(accountFilters.id, filterId))
    .limit(1)

  if (!result[0] || result[0].userId !== auth.userId) {
    return matrixNotFound(c, 'Filter not found')
  }

  return c.json(result[0].filterJson)
})
