import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixNotFound } from '@/shared/middleware/errors'
import { deviceUpdateBody, validate } from '@/shared/validation'

export const deviceRoute = new Hono<AuthEnv>()

deviceRoute.use('/*', authMiddleware)

// GET /devices - list all devices
deviceRoute.get('/', async (c) => {
  const auth = c.get('auth')

  const rows = db.select().from(devices).where(eq(devices.userId, auth.userId)).all()

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
    last_seen_ip: device.ipAddress,
    last_seen_ts: device.lastSeenAt ? Number(device.lastSeenAt) : undefined,
  })
})

// PUT /devices/:deviceId - update display name
deviceRoute.put('/:deviceId', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')
  const body = await c.req.json()

  const v = validate(c, deviceUpdateBody, body)
  if (!v.success)
    return v.response

  await db.update(devices)
    .set({ displayName: v.data.display_name })
    .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))

  return c.json({})
})

// DELETE /devices/:deviceId - delete device and all associated keys
deviceRoute.delete('/:deviceId', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')

  // Revoke OIDC tokens for this device
  const tokenRows = db.select({ grantId: oauthTokens.grantId })
    .from(oauthTokens)
    .where(eq(oauthTokens.deviceId, deviceId))
    .all()

  const grantIds = new Set(tokenRows.map(r => r.grantId).filter(Boolean) as string[])
  for (const grantId of grantIds) {
    db.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run()
  }
  db.delete(oauthTokens).where(eq(oauthTokens.deviceId, deviceId)).run()

  // Clean up E2EE keys
  db.delete(e2eeDeviceKeys).where(and(
    eq(e2eeDeviceKeys.userId, auth.userId),
    eq(e2eeDeviceKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, auth.userId),
    eq(e2eeOneTimeKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeFallbackKeys).where(and(
    eq(e2eeFallbackKeys.userId, auth.userId),
    eq(e2eeFallbackKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeToDeviceMessages).where(and(
    eq(e2eeToDeviceMessages.userId, auth.userId),
    eq(e2eeToDeviceMessages.deviceId, deviceId),
  )).run()

  // Delete device record
  await db.delete(devices)
    .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))

  return c.json({})
})
