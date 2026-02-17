import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq, gt } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeDehydratedDevices, e2eeDeviceKeys, e2eeDeviceListChanges, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { generateUlid } from '@/utils/tokens'

export const dehydratedDeviceRoute = new Hono<AuthEnv>()
dehydratedDeviceRoute.use('/*', authMiddleware)

dehydratedDeviceRoute.put('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()

  const deviceId = body.device_id
  if (!deviceId) {
    return c.json({ errcode: 'M_BAD_JSON', error: 'Missing device_id' }, 400)
  }

  const prev = db.select({ deviceId: e2eeDehydratedDevices.deviceId })
    .from(e2eeDehydratedDevices)
    .where(eq(e2eeDehydratedDevices.userId, auth.userId))
    .get()

  if (prev) {
    const oldId = prev.deviceId
    db.delete(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, auth.userId), eq(e2eeDeviceKeys.deviceId, oldId))).run()
    db.delete(e2eeOneTimeKeys).where(and(eq(e2eeOneTimeKeys.userId, auth.userId), eq(e2eeOneTimeKeys.deviceId, oldId))).run()
    db.delete(e2eeFallbackKeys).where(and(eq(e2eeFallbackKeys.userId, auth.userId), eq(e2eeFallbackKeys.deviceId, oldId))).run()
    db.delete(e2eeToDeviceMessages).where(and(eq(e2eeToDeviceMessages.userId, auth.userId), eq(e2eeToDeviceMessages.deviceId, oldId))).run()
    db.delete(devices).where(and(eq(devices.userId, auth.userId), eq(devices.id, oldId))).run()
    db.delete(e2eeDehydratedDevices).where(eq(e2eeDehydratedDevices.userId, auth.userId)).run()
  }

  db.insert(e2eeDehydratedDevices).values({
    userId: auth.userId,
    deviceId,
    deviceData: body.device_data || {},
  }).run()

  db.insert(devices).values({
    userId: auth.userId,
    id: deviceId,
    displayName: body.initial_device_display_name || 'Dehydrated Device',
  }).onConflictDoNothing().run()

  if (body.device_keys) {
    const dk = body.device_keys
    db.insert(e2eeDeviceKeys).values({
      userId: auth.userId,
      deviceId,
      algorithms: dk.algorithms || [],
      keys: dk.keys || {},
      signatures: dk.signatures || {},
      displayName: dk.unsigned?.device_display_name || null,
    }).onConflictDoUpdate({
      target: [e2eeDeviceKeys.userId, e2eeDeviceKeys.deviceId],
      set: {
        algorithms: dk.algorithms || [],
        keys: dk.keys || {},
        signatures: dk.signatures || {},
      },
    }).run()
  }

  if (body.one_time_keys) {
    for (const [keyIdFull, keyData] of Object.entries(body.one_time_keys)) {
      const colonIdx = keyIdFull.indexOf(':')
      const algorithm = keyIdFull.slice(0, colonIdx)
      const keyId = keyIdFull.slice(colonIdx + 1)
      db.insert(e2eeOneTimeKeys).values({
        userId: auth.userId,
        deviceId,
        algorithm,
        keyId,
        keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
      }).run()
    }
  }

  if (body.fallback_keys) {
    for (const [keyIdFull, keyData] of Object.entries(body.fallback_keys)) {
      const colonIdx = keyIdFull.indexOf(':')
      const algorithm = keyIdFull.slice(0, colonIdx)
      const keyId = keyIdFull.slice(colonIdx + 1)
      db.insert(e2eeFallbackKeys).values({
        userId: auth.userId,
        deviceId,
        algorithm,
        keyId,
        keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
      }).onConflictDoUpdate({
        target: [e2eeFallbackKeys.userId, e2eeFallbackKeys.deviceId, e2eeFallbackKeys.algorithm],
        set: {
          keyId,
          keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
        },
      }).run()
    }
  }

  db.insert(e2eeDeviceListChanges).values({
    userId: auth.userId,
    ulid: generateUlid(),
  }).run()

  return c.json({ device_id: deviceId })
})

dehydratedDeviceRoute.get('/', (c) => {
  const auth = c.get('auth')

  const row = db.select()
    .from(e2eeDehydratedDevices)
    .where(eq(e2eeDehydratedDevices.userId, auth.userId))
    .get()

  if (!row) {
    return c.json({ errcode: 'M_NOT_FOUND', error: 'No dehydrated device' }, 404)
  }

  return c.json({
    device_id: row.deviceId,
    device_data: row.deviceData,
  })
})

dehydratedDeviceRoute.delete('/', (c) => {
  const auth = c.get('auth')

  const row = db.select({ deviceId: e2eeDehydratedDevices.deviceId })
    .from(e2eeDehydratedDevices)
    .where(eq(e2eeDehydratedDevices.userId, auth.userId))
    .get()

  if (!row) {
    return c.json({ errcode: 'M_NOT_FOUND', error: 'No dehydrated device' }, 404)
  }

  const devId = row.deviceId

  db.delete(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, auth.userId), eq(e2eeDeviceKeys.deviceId, devId))).run()
  db.delete(e2eeOneTimeKeys).where(and(eq(e2eeOneTimeKeys.userId, auth.userId), eq(e2eeOneTimeKeys.deviceId, devId))).run()
  db.delete(e2eeFallbackKeys).where(and(eq(e2eeFallbackKeys.userId, auth.userId), eq(e2eeFallbackKeys.deviceId, devId))).run()
  db.delete(e2eeToDeviceMessages).where(and(eq(e2eeToDeviceMessages.userId, auth.userId), eq(e2eeToDeviceMessages.deviceId, devId))).run()
  db.delete(devices).where(and(eq(devices.userId, auth.userId), eq(devices.id, devId))).run()
  db.delete(e2eeDehydratedDevices).where(eq(e2eeDehydratedDevices.userId, auth.userId)).run()

  return c.json({ device_id: devId })
})

dehydratedDeviceRoute.post('/:deviceId/events', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')

  const row = db.select({ deviceId: e2eeDehydratedDevices.deviceId })
    .from(e2eeDehydratedDevices)
    .where(eq(e2eeDehydratedDevices.userId, auth.userId))
    .get()

  if (!row || row.deviceId !== deviceId) {
    return c.json({ errcode: 'M_FORBIDDEN', error: 'Not your dehydrated device' }, 403)
  }

  const body = await c.req.json().catch(() => ({}))
  const nextBatch = body.next_batch ? Number.parseInt(body.next_batch, 10) : 0
  const limit = 100

  const messages = db.select()
    .from(e2eeToDeviceMessages)
    .where(and(
      eq(e2eeToDeviceMessages.userId, auth.userId),
      eq(e2eeToDeviceMessages.deviceId, deviceId),
      gt(e2eeToDeviceMessages.id, nextBatch),
    ))
    .limit(limit)
    .all()

  const events = messages.map(m => ({
    type: m.type,
    sender: m.sender,
    content: m.content,
  }))

  const newBatch = messages.length > 0
    ? String(messages.at(-1)!.id)
    : body.next_batch || '0'

  return c.json({
    events,
    next_batch: newBatch,
  })
})
