import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

export const deviceDeleteRoute = new Hono<AuthEnv>()
deviceDeleteRoute.use('/*', authMiddleware)

deviceDeleteRoute.delete('/:deviceId', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')

  db.transaction((tx) => {
    const tokenRows = tx.select({ grantId: oauthTokens.grantId })
      .from(oauthTokens)
      .where(eq(oauthTokens.deviceId, deviceId))
      .all()

    const grantIds = new Set(tokenRows.map(r => r.grantId).filter(Boolean) as string[])
    for (const grantId of grantIds) {
      tx.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run()
    }
    tx.delete(oauthTokens).where(eq(oauthTokens.deviceId, deviceId)).run()

    tx.delete(e2eeDeviceKeys).where(and(
      eq(e2eeDeviceKeys.userId, auth.userId),
      eq(e2eeDeviceKeys.deviceId, deviceId),
    )).run()

    tx.delete(e2eeOneTimeKeys).where(and(
      eq(e2eeOneTimeKeys.userId, auth.userId),
      eq(e2eeOneTimeKeys.deviceId, deviceId),
    )).run()

    tx.delete(e2eeFallbackKeys).where(and(
      eq(e2eeFallbackKeys.userId, auth.userId),
      eq(e2eeFallbackKeys.deviceId, deviceId),
    )).run()

    tx.delete(e2eeToDeviceMessages).where(and(
      eq(e2eeToDeviceMessages.userId, auth.userId),
      eq(e2eeToDeviceMessages.deviceId, deviceId),
    )).run()

    tx.delete(devices)
      .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))
      .run()
  })

  return c.json({})
})
