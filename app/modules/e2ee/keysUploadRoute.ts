import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountTokens, devices, e2eeDeviceKeys, e2eeDeviceListChanges, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens, roomMembers } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { notifyUser } from '@/modules/sync/notifier'
import { verifyDeviceKeySignature } from '@/shared/helpers/verifyKeys'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'
import { generateUlid } from '@/utils/tokens'

function envFlagEnabled(value?: string): boolean {
  if (!value)
    return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function shouldStrictlyRejectDeviceKeySignatureFailure(): boolean {
  return process.env.NODE_ENV === 'production'
    || envFlagEnabled(process.env.IM_E2EE_STRICT_SIGNATURE_VERIFY)
    || envFlagEnabled(process.env.IM_STRICT_DEVICE_KEY_SIGNATURE_VERIFY)
}

export const keysUploadRoute = new Hono<AuthEnv>()
keysUploadRoute.use('/*', authMiddleware)

keysUploadRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()

  if (body.device_keys) {
    const dk = body.device_keys

    const sigResult = verifyDeviceKeySignature(dk, auth.userId, auth.deviceId)
    if (!sigResult.valid) {
      logger.warn('device_key_signature_failed', { userId: auth.userId, deviceId: auth.deviceId, reason: sigResult.reason })
      if (shouldStrictlyRejectDeviceKeySignatureFailure())
        return matrixError(c, 'M_INVALID_PARAM', 'Device key signature verification failed')
    }

    const existing = db.select({ keys: e2eeDeviceKeys.keys, signatures: e2eeDeviceKeys.signatures }).from(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, auth.userId), eq(e2eeDeviceKeys.deviceId, auth.deviceId))).get()

    const keysChanged = !existing || JSON.stringify(existing.keys) !== JSON.stringify(dk.keys)

    let mergedSignatures = dk.signatures || {}
    if (!keysChanged && existing) {
      const existingSigs = existing.signatures as Record<string, Record<string, string>>
      mergedSignatures = { ...existingSigs }
      for (const [sigUserId, sigs] of Object.entries(dk.signatures || {}) as [string, Record<string, string>][]) {
        (mergedSignatures as Record<string, Record<string, string>>)[sigUserId] = {
          ...((mergedSignatures as Record<string, Record<string, string>>)[sigUserId] || {}),
          ...sigs,
        }
      }
    }

    await db.insert(e2eeDeviceKeys).values({
      userId: auth.userId,
      deviceId: auth.deviceId,
      algorithms: dk.algorithms || [],
      keys: dk.keys || {},
      signatures: mergedSignatures,
      displayName: dk.unsigned?.device_display_name || null,
    }).onConflictDoUpdate({
      target: [e2eeDeviceKeys.userId, e2eeDeviceKeys.deviceId],
      set: {
        algorithms: dk.algorithms || [],
        keys: dk.keys || {},
        signatures: mergedSignatures,
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
