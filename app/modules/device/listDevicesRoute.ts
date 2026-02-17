import type { AuthEnv } from '@/shared/middleware/auth'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

export const deviceListRoute = new Hono<AuthEnv>()
deviceListRoute.use('/*', authMiddleware)

deviceListRoute.get('/', async (c) => {
  const auth = c.get('auth')

  const rows = db.select()
    .from(devices)
    .where(eq(devices.userId, auth.userId))
    .orderBy(desc(devices.lastSeenAt), desc(devices.createdAt))
    .all()

  return c.json({
    devices: rows.map(d => ({
      device_id: d.id,
      display_name: d.displayName,
      last_seen_ip: d.ipAddress,
      last_seen_ts: d.lastSeenAt ? Number(d.lastSeenAt) : undefined,
    })),
  })
})
