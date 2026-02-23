import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountDataCrossSigning, devices, e2eeDeviceKeys } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'

export const keysQueryRoute = new Hono<AuthEnv>()
keysQueryRoute.use('/*', authMiddleware)

keysQueryRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const requestedDevices = body.device_keys || {}

  if (auth.trustState !== 'trusted') {
    const requestedUsers = Object.keys(requestedDevices)
    const containsForeignUsers = requestedUsers.some(userId => userId !== auth.userId)
    if (containsForeignUsers) {
      return matrixError(c, 'M_FORBIDDEN', 'Device is not verified', { errcode_detail: 'M_DEVICE_UNVERIFIED' })
    }
  }

  const e2eeDeviceKeysResult: Record<string, Record<string, any>> = {}
  const masterKeys: Record<string, any> = {}
  const selfSigningKeys: Record<string, any> = {}
  const userSigningKeys: Record<string, any> = {}

  for (const [userId, deviceList] of Object.entries(requestedDevices) as [string, string[]][]) {
    e2eeDeviceKeysResult[userId] = {}

    const activeDevices = new Set(
      db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId)).all().map(d => d.id),
    )

    let dkRows = db.select().from(e2eeDeviceKeys).where(eq(e2eeDeviceKeys.userId, userId)).all().filter(dk => activeDevices.has(dk.deviceId))

    if (deviceList.length > 0) {
      dkRows = dkRows.filter(dk => deviceList.includes(dk.deviceId))
    }

    for (const dk of dkRows) {
      e2eeDeviceKeysResult[userId]![dk.deviceId] = {
        user_id: userId,
        device_id: dk.deviceId,
        algorithms: dk.algorithms,
        keys: dk.keys,
        signatures: dk.signatures,
        ...(dk.displayName ? { unsigned: { device_display_name: dk.displayName } } : {}),
      }
    }

    const csKeys = db.select({
      keyType: accountDataCrossSigning.keyType,
      keyData: accountDataCrossSigning.keyData,
    }).from(accountDataCrossSigning).where(eq(accountDataCrossSigning.userId, userId)).all()

    for (const csk of csKeys) {
      const keyData = csk.keyData as any
      const keyType = csk.keyType
      if (keyType === 'master') {
        masterKeys[userId] = keyData
      }
      else if (keyType === 'self_signing') {
        selfSigningKeys[userId] = keyData
      }
      else if (keyType === 'user_signing' && userId === auth.userId) {
        userSigningKeys[userId] = keyData
      }
    }
  }

  return c.json({
    device_keys: e2eeDeviceKeysResult,
    failures: {},
    master_keys: masterKeys,
    self_signing_keys: selfSigningKeys,
    user_signing_keys: userSigningKeys,
  })
})
