import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { deviceKeys, devices, crossSigningKeys } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const keysQueryRoute = new Hono()

keysQueryRoute.use('/*', authMiddleware)

keysQueryRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json()
  const requestedDevices = body.device_keys || {}

  const deviceKeysResult: Record<string, Record<string, any>> = {}
  const masterKeys: Record<string, any> = {}
  const selfSigningKeys: Record<string, any> = {}
  const userSigningKeys: Record<string, any> = {}

  for (const [userId, deviceList] of Object.entries(requestedDevices) as [string, string[]][]) {
    deviceKeysResult[userId] = {}

    // Get all device keys for this user
    let dkRows
    if (deviceList.length === 0) {
      // Empty array = get all devices
      dkRows = db.select().from(deviceKeys)
        .where(eq(deviceKeys.userId, userId))
        .all()
    }
    else {
      dkRows = db.select().from(deviceKeys)
        .where(eq(deviceKeys.userId, userId))
        .all()
        .filter(dk => deviceList.includes(dk.deviceId))
    }

    for (const dk of dkRows) {
      deviceKeysResult[userId]![dk.deviceId] = {
        user_id: userId,
        device_id: dk.deviceId,
        algorithms: dk.algorithms,
        keys: dk.keys,
        signatures: dk.signatures,
        ...(dk.displayName ? { unsigned: { device_display_name: dk.displayName } } : {}),
      }
    }

    // Get cross-signing keys
    const csKeys = db.select().from(crossSigningKeys)
      .where(eq(crossSigningKeys.userId, userId))
      .all()

    for (const csk of csKeys) {
      const keyData = csk.keyData as any
      if (csk.keyType === 'master') {
        masterKeys[userId] = keyData
      }
      else if (csk.keyType === 'self_signing') {
        selfSigningKeys[userId] = keyData
      }
      else if (csk.keyType === 'user_signing' && userId === auth.userId) {
        // User signing keys are only returned for the requesting user
        userSigningKeys[userId] = keyData
      }
    }
  }

  return c.json({
    device_keys: deviceKeysResult,
    failures: {},
    master_keys: masterKeys,
    self_signing_keys: selfSigningKeys,
    user_signing_keys: userSigningKeys,
  })
})
