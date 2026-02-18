import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

export const logoutRoute = new Hono<AuthEnv>()
logoutRoute.use('/*', authMiddleware)

logoutRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const token = c.req.header('Authorization')?.slice(7)

  if (token) {
    db.delete(oauthTokens).where(eq(oauthTokens.id, `AccessToken:${token}`)).run()
  }

  deleteDeviceKeys(auth.userId, auth.deviceId)

  db.delete(devices).where(and(
    eq(devices.userId, auth.userId),
    eq(devices.id, auth.deviceId),
  )).run()

  logger.info('logout', { userId: auth.userId, deviceId: auth.deviceId })

  return c.json({})
})

logoutRoute.post('/all', async (c) => {
  const auth = c.get('auth')

  const deviceCount = db.transaction((tx) => {
    const userDevices = tx.select({ id: devices.id }).from(devices).where(eq(devices.userId, auth.userId)).all()

    for (const d of userDevices) {
      tx.delete(e2eeDeviceKeys).where(and(
        eq(e2eeDeviceKeys.userId, auth.userId),
        eq(e2eeDeviceKeys.deviceId, d.id),
      )).run()

      tx.delete(e2eeOneTimeKeys).where(and(
        eq(e2eeOneTimeKeys.userId, auth.userId),
        eq(e2eeOneTimeKeys.deviceId, d.id),
      )).run()

      tx.delete(e2eeFallbackKeys).where(and(
        eq(e2eeFallbackKeys.userId, auth.userId),
        eq(e2eeFallbackKeys.deviceId, d.id),
      )).run()

      tx.delete(e2eeToDeviceMessages).where(and(
        eq(e2eeToDeviceMessages.userId, auth.userId),
        eq(e2eeToDeviceMessages.deviceId, d.id),
      )).run()
    }

    const localpart = auth.userId.split(':')[0]!.slice(1)
    const userTokenRows = tx.select({ grantId: oauthTokens.grantId })
      .from(oauthTokens)
      .where(eq(oauthTokens.accountId, localpart))
      .all()

    const grantIds = new Set(userTokenRows.map(r => r.grantId).filter(Boolean) as string[])
    for (const grantId of grantIds) {
      tx.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run()
    }
    tx.delete(oauthTokens).where(eq(oauthTokens.accountId, localpart)).run()

    tx.delete(devices).where(eq(devices.userId, auth.userId)).run()

    return userDevices.length
  })

  logger.info('logout_all', { userId: auth.userId, deviceCount })

  return c.json({})
})

function deleteDeviceKeys(userId: string, deviceId: string) {
  db.delete(e2eeDeviceKeys).where(and(
    eq(e2eeDeviceKeys.userId, userId),
    eq(e2eeDeviceKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, userId),
    eq(e2eeOneTimeKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeFallbackKeys).where(and(
    eq(e2eeFallbackKeys.userId, userId),
    eq(e2eeFallbackKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeToDeviceMessages).where(and(
    eq(e2eeToDeviceMessages.userId, userId),
    eq(e2eeToDeviceMessages.deviceId, deviceId),
  )).run()
}
