import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { filters } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound } from '@/middleware/errors'

export const userFilterRoute = new Hono()

userFilterRoute.use('/*', authMiddleware)

// POST /user/:userId/filter - create a filter
userFilterRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json()

  const result = await db.insert(filters).values({
    userId: auth.userId,
    filterJson: body,
  }).returning({ id: filters.id })

  return c.json({ filter_id: String(result[0]!.id) })
})

// GET /user/:userId/filter/:filterId - get a filter
userFilterRoute.get('/:filterId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const filterId = Number.parseInt(c.req.param('filterId'))

  if (Number.isNaN(filterId)) {
    return matrixNotFound(c, 'Filter not found')
  }

  const result = await db.select()
    .from(filters)
    .where(eq(filters.id, filterId))
    .limit(1)

  if (!result[0] || result[0].userId !== auth.userId) {
    return matrixNotFound(c, 'Filter not found')
  }

  return c.json(result[0].filterJson)
})
