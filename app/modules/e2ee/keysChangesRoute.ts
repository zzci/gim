import type { AuthEnv } from '@/shared/middleware/auth'
import { and, gt, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { e2eeDeviceListChanges } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

export const keysChangesRoute = new Hono<AuthEnv>()
keysChangesRoute.use('/*', authMiddleware)

keysChangesRoute.get('/', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''

  if (!from || !to) {
    return c.json({ changed: [], left: [] })
  }

  const changes = db.select({ userId: e2eeDeviceListChanges.userId })
    .from(e2eeDeviceListChanges)
    .where(and(
      gt(e2eeDeviceListChanges.ulid, from),
      lte(e2eeDeviceListChanges.ulid, to),
    ))
    .all()

  const changed = [...new Set(changes.map(c => c.userId))]

  return c.json({ changed, left: [] })
})
