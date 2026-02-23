import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { listDevices } from '@/models/device'
import { authMiddleware } from '@/shared/middleware/auth'

export const deviceListRoute = new Hono<AuthEnv>()
deviceListRoute.use('/*', authMiddleware)

deviceListRoute.get('/', async (c) => {
  const auth = c.get('auth')

  const rows = listDevices(auth.userId)

  return c.json({
    devices: rows.map(d => ({
      device_id: d.id,
      display_name: d.displayName,
      trust_state: d.trustState,
      trust_reason: d.trustReason,
      verified_at: d.verifiedAt ? Number(d.verifiedAt) : undefined,
      verified_by_device_id: d.verifiedByDeviceId || undefined,
      last_seen_ip: d.ipAddress,
      last_seen_ts: d.lastSeenAt ? Number(d.lastSeenAt) : undefined,
    })),
  })
})
