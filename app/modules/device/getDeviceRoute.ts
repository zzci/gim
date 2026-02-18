import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixNotFound } from '@/shared/middleware/errors'

export const deviceGetRoute = new Hono<AuthEnv>()
deviceGetRoute.use('/*', authMiddleware)

deviceGetRoute.get('/:deviceId', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')

  const device = db.select().from(devices).where(and(
    eq(devices.userId, auth.userId),
    eq(devices.id, deviceId),
  )).get()

  if (!device)
    return matrixNotFound(c, 'Device not found')

  return c.json({
    device_id: device.id,
    display_name: device.displayName,
    trust_state: device.trustState,
    trust_reason: device.trustReason,
    verified_at: device.verifiedAt ? Number(device.verifiedAt) : undefined,
    verified_by_device_id: device.verifiedByDeviceId || undefined,
    last_seen_ip: device.ipAddress,
    last_seen_ts: device.lastSeenAt ? Number(device.lastSeenAt) : undefined,
  })
})
