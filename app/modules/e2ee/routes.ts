import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq, gt, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountCrossSigningKeys, accountTokens, devices, e2eeDehydratedDevices, e2eeDeviceKeys, e2eeDeviceListChanges, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens, roomMembers } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { notifyUser } from '@/modules/sync/notifier'
import { verifyDeviceKeySignature } from '@/shared/helpers/verifyKeys'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'
import { generateUlid } from '@/utils/tokens'

// --- Keys Upload ---

export const keysUploadRoute = new Hono<AuthEnv>()
keysUploadRoute.use('/*', authMiddleware)

keysUploadRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()

  // Upload device keys
  if (body.device_keys) {
    const dk = body.device_keys

    // Verify Ed25519 self-signature
    const sigResult = verifyDeviceKeySignature(dk, auth.userId, auth.deviceId)
    if (!sigResult.valid) {
      logger.warn('device_key_signature_failed', { userId: auth.userId, deviceId: auth.deviceId, reason: sigResult.reason })
      return matrixError(c, 'M_INVALID_PARAM', 'Device key signature verification failed')
    }

    const existing = db.select({ keys: e2eeDeviceKeys.keys }).from(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, auth.userId), eq(e2eeDeviceKeys.deviceId, auth.deviceId))).get()

    const keysChanged = !existing || JSON.stringify(existing.keys) !== JSON.stringify(dk.keys)

    await db.insert(e2eeDeviceKeys).values({
      userId: auth.userId,
      deviceId: auth.deviceId,
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
        displayName: dk.unsigned?.device_display_name || null,
      },
    })

    if (keysChanged) {
      db.transaction((tx) => {
        tx.delete(e2eeOneTimeKeys).where(and(
          eq(e2eeOneTimeKeys.userId, auth.userId),
          eq(e2eeOneTimeKeys.deviceId, auth.deviceId),
        )).run()

        tx.delete(e2eeFallbackKeys).where(and(
          eq(e2eeFallbackKeys.userId, auth.userId),
          eq(e2eeFallbackKeys.deviceId, auth.deviceId),
        )).run()

        tx.delete(e2eeToDeviceMessages).where(and(
          eq(e2eeToDeviceMessages.userId, auth.userId),
          eq(e2eeToDeviceMessages.deviceId, auth.deviceId),
        )).run()

        tx.update(devices)
          .set({ lastToDeviceStreamId: 0, pendingKeyChange: true })
          .where(and(eq(devices.userId, auth.userId), eq(devices.id, auth.deviceId)))
          .run()

        const localpart = auth.userId.split(':')[0]!.slice(1)
        const oauthDeviceIds = tx.select({ deviceId: oauthTokens.deviceId })
          .from(oauthTokens)
          .where(and(
            eq(oauthTokens.type, 'AccessToken'),
            eq(oauthTokens.accountId, localpart),
          ))
          .all()
          .map(r => r.deviceId)
          .filter(Boolean) as string[]

        const userTokenDeviceIds = tx.select({ deviceId: accountTokens.deviceId })
          .from(accountTokens)
          .where(eq(accountTokens.userId, auth.userId))
          .all()
          .map(r => r.deviceId)

        const validTokenDeviceIds = [...new Set([...oauthDeviceIds, ...userTokenDeviceIds])]

        const allUserDevices = tx.select({ id: devices.id })
          .from(devices)
          .where(eq(devices.userId, auth.userId))
          .all()

        const orphanedDeviceIds = allUserDevices
          .filter(d => d.id !== auth.deviceId && !validTokenDeviceIds.includes(d.id))
          .map(d => d.id)

        if (orphanedDeviceIds.length > 0) {
          for (const orphanId of orphanedDeviceIds) {
            tx.delete(e2eeDeviceKeys).where(and(
              eq(e2eeDeviceKeys.userId, auth.userId),
              eq(e2eeDeviceKeys.deviceId, orphanId),
            )).run()
            tx.delete(e2eeOneTimeKeys).where(and(
              eq(e2eeOneTimeKeys.userId, auth.userId),
              eq(e2eeOneTimeKeys.deviceId, orphanId),
            )).run()
            tx.delete(e2eeFallbackKeys).where(and(
              eq(e2eeFallbackKeys.userId, auth.userId),
              eq(e2eeFallbackKeys.deviceId, orphanId),
            )).run()
            tx.delete(e2eeToDeviceMessages).where(and(
              eq(e2eeToDeviceMessages.userId, auth.userId),
              eq(e2eeToDeviceMessages.deviceId, orphanId),
            )).run()
            tx.delete(devices).where(and(
              eq(devices.userId, auth.userId),
              eq(devices.id, orphanId),
            )).run()
          }
        }
      })

      const sharedRooms = db.select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .where(and(
          eq(roomMembers.userId, auth.userId),
          eq(roomMembers.membership, 'join'),
        ))
        .all()

      for (const room of sharedRooms) {
        createEvent({
          roomId: room.roomId,
          sender: auth.userId,
          type: 'm.room.message',
          content: {
            msgtype: 'm.notice',
            body: `${auth.userId} 的加密设备已更换，新的加密会话已建立`,
          },
        })
      }
    }
  }

  // Upload one-time keys
  if (body.one_time_keys) {
    for (const [keyIdFull, keyData] of Object.entries(body.one_time_keys)) {
      const colonIdx = keyIdFull.indexOf(':')
      const algorithm = keyIdFull.slice(0, colonIdx)
      const keyId = keyIdFull.slice(colonIdx + 1)

      await db.insert(e2eeOneTimeKeys).values({
        userId: auth.userId,
        deviceId: auth.deviceId,
        algorithm,
        keyId,
        keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
      })
    }

    let shouldNotify = false
    db.transaction((tx) => {
      const updated = tx.update(devices)
        .set({ pendingKeyChange: false })
        .where(and(eq(devices.userId, auth.userId), eq(devices.id, auth.deviceId), eq(devices.pendingKeyChange, true)))
        .returning({ id: devices.id })
        .all()

      if (updated.length > 0) {
        tx.insert(e2eeDeviceListChanges).values({
          userId: auth.userId,
          ulid: generateUlid(),
        }).run()

        shouldNotify = true
      }
    })

    if (shouldNotify) {
      const sharedRooms = db.select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .where(and(
          eq(roomMembers.userId, auth.userId),
          eq(roomMembers.membership, 'join'),
        ))
        .all()

      const notified = new Set<string>()
      for (const room of sharedRooms) {
        const members = db.select({ userId: roomMembers.userId })
          .from(roomMembers)
          .where(and(
            eq(roomMembers.roomId, room.roomId),
            eq(roomMembers.membership, 'join'),
          ))
          .all()
        for (const m of members) {
          if (m.userId !== auth.userId && !notified.has(m.userId)) {
            notified.add(m.userId)
            notifyUser(m.userId)
          }
        }
      }
    }
  }

  // Upload fallback keys
  if (body.fallback_keys || body['org.matrix.msc2732.fallback_keys']) {
    const fk = body.fallback_keys || body['org.matrix.msc2732.fallback_keys']
    for (const [keyIdFull, keyData] of Object.entries(fk)) {
      const colonIdx = keyIdFull.indexOf(':')
      const algorithm = keyIdFull.slice(0, colonIdx)
      const keyId = keyIdFull.slice(colonIdx + 1)

      await db.insert(e2eeFallbackKeys).values({
        userId: auth.userId,
        deviceId: auth.deviceId,
        algorithm,
        keyId,
        keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
      }).onConflictDoUpdate({
        target: [e2eeFallbackKeys.userId, e2eeFallbackKeys.deviceId, e2eeFallbackKeys.algorithm],
        set: {
          keyId,
          keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
        },
      })
    }
  }

  // Count unclaimed one-time keys
  const counts: Record<string, number> = {}
  const otkRows = db.select({ algorithm: e2eeOneTimeKeys.algorithm })
    .from(e2eeOneTimeKeys)
    .where(and(
      eq(e2eeOneTimeKeys.userId, auth.userId),
      eq(e2eeOneTimeKeys.deviceId, auth.deviceId),
      eq(e2eeOneTimeKeys.claimed, false),
    ))
    .all()

  for (const row of otkRows) {
    counts[row.algorithm] = (counts[row.algorithm] || 0) + 1
  }

  logger.info('keys_uploaded', { userId: auth.userId, deviceId: auth.deviceId, otkCount: Object.values(counts).reduce((a, b) => a + b, 0) })

  return c.json({ one_time_key_counts: counts })
})

// --- Keys Query ---

export const keysQueryRoute = new Hono<AuthEnv>()
keysQueryRoute.use('/*', authMiddleware)

keysQueryRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const requestedDevices = body.device_keys || {}

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

    const csKeys = db.select().from(accountCrossSigningKeys).where(eq(accountCrossSigningKeys.userId, userId)).all()

    for (const csk of csKeys) {
      const keyData = csk.keyData as any
      if (csk.keyType === 'master') {
        masterKeys[userId] = keyData
      }
      else if (csk.keyType === 'self_signing') {
        selfSigningKeys[userId] = keyData
      }
      else if (csk.keyType === 'user_signing' && userId === auth.userId) {
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

// --- Keys Claim ---

export const keysClaimRoute = new Hono<AuthEnv>()
keysClaimRoute.use('/*', authMiddleware)

keysClaimRoute.post('/', async (c) => {
  const body = await c.req.json()
  const requested = body.one_time_keys || {}

  const result: Record<string, Record<string, any>> = {}

  for (const [userId, deviceMap] of Object.entries(requested) as [string, Record<string, string>][]) {
    result[userId] = {}

    for (const [deviceId, algorithm] of Object.entries(deviceMap)) {
      const otk = db.select().from(e2eeOneTimeKeys).where(and(
        eq(e2eeOneTimeKeys.userId, userId),
        eq(e2eeOneTimeKeys.deviceId, deviceId),
        eq(e2eeOneTimeKeys.algorithm, algorithm),
        eq(e2eeOneTimeKeys.claimed, false),
      )).limit(1).get()

      if (otk) {
        db.update(e2eeOneTimeKeys)
          .set({ claimed: true })
          .where(eq(e2eeOneTimeKeys.id, otk.id))
          .run()

        result[userId]![deviceId] = {
          [`${otk.algorithm}:${otk.keyId}`]: otk.keyJson,
        }
      }
      else {
        const fbk = db.select().from(e2eeFallbackKeys).where(and(
          eq(e2eeFallbackKeys.userId, userId),
          eq(e2eeFallbackKeys.deviceId, deviceId),
          eq(e2eeFallbackKeys.algorithm, algorithm),
        )).limit(1).get()

        if (fbk) {
          result[userId]![deviceId] = {
            [`${fbk.algorithm}:${fbk.keyId}`]: fbk.keyJson,
          }
        }
      }
    }
  }

  return c.json({
    one_time_keys: result,
    failures: {},
  })
})

// --- Keys Changes ---

export const keysChangesRoute = new Hono<AuthEnv>()
keysChangesRoute.use('/*', authMiddleware)

keysChangesRoute.get('/', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''

  if (!from || !to) {
    return c.json({ changed: [], left: [] })
  }

  const changes = db.select({ userId: e2eeDeviceListChanges.userId })
    .from(e2eeDeviceListChanges)
    .where(and(
      gt(e2eeDeviceListChanges.ulid, from),
      lte(e2eeDeviceListChanges.ulid, to),
    ))
    .all()

  const changed = [...new Set(changes.map(c => c.userId))]

  return c.json({ changed, left: [] })
})

// --- Cross-Signing ---

export const crossSigningRoute = new Hono<AuthEnv>()
crossSigningRoute.use('/*', authMiddleware)

crossSigningRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()

  const keyTypes = [
    { field: 'master_key', usage: 'master', dbType: 'master' as const },
    { field: 'self_signing_key', usage: 'self_signing', dbType: 'self_signing' as const },
    { field: 'user_signing_key', usage: 'user_signing', dbType: 'user_signing' as const },
  ]

  for (const { field, usage, dbType } of keyTypes) {
    const keyData = body[field]
    if (!keyData)
      continue

    // Validate required fields
    if (!keyData.keys || typeof keyData.keys !== 'object') {
      return matrixError(c, 'M_INVALID_PARAM', `Missing or invalid "keys" in ${field}`)
    }

    if (!keyData.signatures || typeof keyData.signatures !== 'object' || Object.keys(keyData.signatures).length === 0) {
      return matrixError(c, 'M_INVALID_PARAM', `Missing or empty "signatures" in ${field}`)
    }

    if (!Array.isArray(keyData.usage) || !keyData.usage.includes(usage)) {
      return matrixError(c, 'M_INVALID_PARAM', `Invalid "usage" in ${field}, expected ["${usage}"]`)
    }

    // Validate exactly one ed25519 key
    const ed25519Keys = Object.keys(keyData.keys).filter(k => k.startsWith('ed25519:'))
    if (ed25519Keys.length !== 1) {
      return matrixError(c, 'M_INVALID_PARAM', `Expected exactly one ed25519 key in ${field}, found ${ed25519Keys.length}`)
    }

    // Validate user_id matches authenticated user
    if (keyData.user_id && keyData.user_id !== auth.userId) {
      return matrixError(c, 'M_INVALID_PARAM', `user_id in ${field} does not match authenticated user`)
    }

    await db.insert(accountCrossSigningKeys).values({
      userId: auth.userId,
      keyType: dbType,
      keyData,
    }).onConflictDoUpdate({
      target: [accountCrossSigningKeys.userId, accountCrossSigningKeys.keyType],
      set: { keyData },
    })
  }

  // Notify clients about cross-signing key changes
  db.insert(e2eeDeviceListChanges).values({
    userId: auth.userId,
    ulid: generateUlid(),
  }).run()
  notifyUser(auth.userId)

  return c.json({})
})

// --- Signatures Upload ---

export const signaturesUploadRoute = new Hono<AuthEnv>()
signaturesUploadRoute.use('/*', authMiddleware)

signaturesUploadRoute.post('/', async (c) => {
  const body = await c.req.json()
  const failures: Record<string, Record<string, any>> = {}

  for (const [userId, keyMap] of Object.entries(body) as [string, Record<string, any>][]) {
    for (const [keyId, signedObject] of Object.entries(keyMap)) {
      const newSignatures = signedObject.signatures || {}

      const dk = db.select().from(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, keyId))).get()

      if (dk) {
        const merged = { ...(dk.signatures as Record<string, Record<string, string>>) }
        for (const [sigUserId, sigs] of Object.entries(newSignatures) as [string, Record<string, string>][]) {
          merged[sigUserId] = { ...(merged[sigUserId] || {}), ...sigs }
        }
        db.update(e2eeDeviceKeys)
          .set({ signatures: merged })
          .where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, keyId)))
          .run()
        continue
      }

      const csKeys = db.select().from(accountCrossSigningKeys).where(eq(accountCrossSigningKeys.userId, userId)).all()

      let matched = false
      for (const csk of csKeys) {
        const keyData = csk.keyData as any
        const keys = keyData.keys || {}
        if (Object.keys(keys).some((k: string) => k.includes(keyId) || keyId === k)) {
          const mergedSigs = { ...(keyData.signatures || {}) }
          for (const [sigUserId, sigs] of Object.entries(newSignatures) as [string, Record<string, string>][]) {
            mergedSigs[sigUserId] = { ...(mergedSigs[sigUserId] || {}), ...sigs }
          }
          db.update(accountCrossSigningKeys)
            .set({ keyData: { ...keyData, signatures: mergedSigs } })
            .where(and(eq(accountCrossSigningKeys.userId, userId), eq(accountCrossSigningKeys.keyType, csk.keyType)))
            .run()
          matched = true
          break
        }
      }

      if (!matched) {
        if (!failures[userId])
          failures[userId] = {}
        failures[userId][keyId] = { errcode: 'M_NOT_FOUND', error: 'Key not found' }
      }
    }

    // Notify clients about signature changes for this user
    db.insert(e2eeDeviceListChanges).values({
      userId,
      ulid: generateUlid(),
    }).run()
    notifyUser(userId)
  }

  return c.json({ failures })
})

// --- Send To Device ---

export const sendToDeviceRoute = new Hono<AuthEnv>()
sendToDeviceRoute.use('/*', authMiddleware)

sendToDeviceRoute.put('/:eventType/:txnId', async (c) => {
  const auth = c.get('auth')
  const eventType = c.req.param('eventType')
  const body = await c.req.json()
  const messages = body.messages || {}

  const notifiedUsers = new Set<string>()

  for (const [userId, deviceMap] of Object.entries(messages) as [string, Record<string, any>][]) {
    for (const [deviceId, content] of Object.entries(deviceMap)) {
      if (deviceId === '*') {
        const userDevices = db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId)).all()

        for (const d of userDevices) {
          db.insert(e2eeToDeviceMessages).values({
            userId,
            deviceId: d.id,
            type: eventType,
            content: content || {},
            sender: auth.userId,
          }).run()
        }
        notifiedUsers.add(userId)
        continue
      }

      db.insert(e2eeToDeviceMessages).values({
        userId,
        deviceId,
        type: eventType,
        content: content || {},
        sender: auth.userId,
      }).run()
      notifiedUsers.add(userId)
    }
  }

  for (const userId of notifiedUsers) {
    notifyUser(userId)
  }

  return c.json({})
})

// --- Dehydrated Device ---

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
