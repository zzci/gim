import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { devices, accessTokens } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound } from '@/middleware/errors'

export const deviceRoute = new Hono()

deviceRoute.use('/*', authMiddleware)

// GET /devices - list all devices
deviceRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext

  const rows = db.select().from(devices)
    .where(eq(devices.userId, auth.userId))
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

// GET /devices/:deviceId
deviceRoute.get('/:deviceId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const deviceId = c.req.param('deviceId')

  const device = db.select().from(devices)
    .where(and(
      eq(devices.userId, auth.userId),
      eq(devices.id, deviceId),
    ))
    .get()

  if (!device) return matrixNotFound(c, 'Device not found')

  return c.json({
    device_id: device.id,
    display_name: device.displayName,
    last_seen_ip: device.ipAddress,
    last_seen_ts: device.lastSeenAt ? Number(device.lastSeenAt) : undefined,
  })
})

// PUT /devices/:deviceId - update display name
deviceRoute.put('/:deviceId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const deviceId = c.req.param('deviceId')
  const body = await c.req.json()

  await db.update(devices)
    .set({ displayName: body.display_name })
    .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))

  return c.json({})
})

// DELETE /devices/:deviceId
deviceRoute.delete('/:deviceId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const deviceId = c.req.param('deviceId')

  await db.delete(accessTokens)
    .where(and(eq(accessTokens.userId, auth.userId), eq(accessTokens.deviceId, deviceId)))

  await db.delete(devices)
    .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))

  return c.json({})
})
