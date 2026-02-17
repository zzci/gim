import type { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens } from '@/db/schema'
import { getAdminContext, logAdminAction } from './helpers'

export function registerAdminDevicesRoutes(adminRoute: Hono) {
  // GET /api/devices — List devices
  adminRoute.get('/api/devices', (c) => {
    const userId = c.req.query('userId')

    const where = userId ? eq(devices.userId, userId) : undefined
    const rows = db.select().from(devices).where(where).all()

    return c.json({ devices: rows })
  })

  // DELETE /api/devices/:userId/:deviceId — Delete device and all associated data
  adminRoute.delete('/api/devices/:userId/:deviceId', (c) => {
    const userId = c.req.param('userId')
    const deviceId = c.req.param('deviceId')

    db.delete(devices).where(and(eq(devices.userId, userId), eq(devices.id, deviceId))).run()
    db.delete(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, deviceId))).run()
    db.delete(e2eeOneTimeKeys).where(and(eq(e2eeOneTimeKeys.userId, userId), eq(e2eeOneTimeKeys.deviceId, deviceId))).run()
    db.delete(e2eeFallbackKeys).where(and(eq(e2eeFallbackKeys.userId, userId), eq(e2eeFallbackKeys.deviceId, deviceId))).run()
    db.delete(oauthTokens).where(eq(oauthTokens.deviceId, deviceId)).run()
    db.delete(e2eeToDeviceMessages).where(and(eq(e2eeToDeviceMessages.userId, userId), eq(e2eeToDeviceMessages.deviceId, deviceId))).run()

    const { adminUserId, ip } = getAdminContext(c)
    logAdminAction(adminUserId, 'device.delete', 'device', `${userId}/${deviceId}`, null, ip)

    return c.json({ success: true })
  })
}
