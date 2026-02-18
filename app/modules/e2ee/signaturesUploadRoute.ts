import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountDataCrossSigning, e2eeDeviceKeys, e2eeDeviceListChanges } from '@/db/schema'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { generateUlid } from '@/utils/tokens'

export const signaturesUploadRoute = new Hono<AuthEnv>()
signaturesUploadRoute.use('/*', authMiddleware)

signaturesUploadRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const failures: Record<string, Record<string, any>> = {}

  for (const [userId, keyMap] of Object.entries(body) as [string, Record<string, any>][]) {
    if (userId !== auth.userId) {
      if (!failures[userId])
        failures[userId] = {}
      for (const keyId of Object.keys(keyMap)) {
        failures[userId][keyId] = { errcode: 'M_FORBIDDEN', error: 'Cannot upload signatures for other users' }
      }
      continue
    }

    let anySuccess = false
    for (const [keyId, signedObject] of Object.entries(keyMap)) {
      const newSignatures = signedObject.signatures || {}
      const deviceIdCandidates = [keyId]
      if (keyId.startsWith('ed25519:')) {
        deviceIdCandidates.push(keyId.slice('ed25519:'.length))
      }
      else {
        deviceIdCandidates.push(`ed25519:${keyId}`)
      }

      const dk = db.select().from(e2eeDeviceKeys).where(and(
        eq(e2eeDeviceKeys.userId, userId),
        eq(e2eeDeviceKeys.deviceId, deviceIdCandidates[0]!),
      )).get() || db.select().from(e2eeDeviceKeys).where(and(
        eq(e2eeDeviceKeys.userId, userId),
        eq(e2eeDeviceKeys.deviceId, deviceIdCandidates[1]!),
      )).get()

      if (dk) {
        const merged = { ...(dk.signatures as Record<string, Record<string, string>>) }
        for (const [sigUserId, sigs] of Object.entries(newSignatures) as [string, Record<string, string>][]) {
          merged[sigUserId] = { ...(merged[sigUserId] || {}), ...sigs }
        }
        db.update(e2eeDeviceKeys)
          .set({ signatures: merged })
          .where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, dk.deviceId)))
          .run()
        logger.debug('signatures_upload_applied_device_key', { userId, keyId, matchedDeviceId: dk.deviceId })
        anySuccess = true
        continue
      }

      const csKeys = db.select({
        keyType: accountDataCrossSigning.keyType,
        keyData: accountDataCrossSigning.keyData,
      }).from(accountDataCrossSigning).where(eq(accountDataCrossSigning.userId, userId)).all()

      let matched = false
      for (const csk of csKeys) {
        const keyData = csk.keyData as any
        const keys = keyData.keys || {}
        if (Object.keys(keys).some((k: string) => k === keyId || k === `ed25519:${keyId}` || keyId === `ed25519:${k.split(':').pop()}`)) {
          const mergedSigs = { ...(keyData.signatures || {}) }
          for (const [sigUserId, sigs] of Object.entries(newSignatures) as [string, Record<string, string>][]) {
            mergedSigs[sigUserId] = { ...(mergedSigs[sigUserId] || {}), ...sigs }
          }
          db.update(accountDataCrossSigning)
            .set({ keyData: { ...keyData, signatures: mergedSigs } })
            .where(and(
              eq(accountDataCrossSigning.userId, userId),
              eq(accountDataCrossSigning.keyType, csk.keyType),
            ))
            .run()
          logger.debug('signatures_upload_applied_cross_signing_key', { userId, keyId, matchedKeyType: csk.keyType })
          matched = true
          anySuccess = true
          break
        }
      }

      if (!matched) {
        if (!failures[userId])
          failures[userId] = {}
        failures[userId][keyId] = { errcode: 'M_NOT_FOUND', error: 'Key not found' }
        logger.warn('signatures_upload_key_not_found', { userId, keyId })
      }
    }

    if (anySuccess) {
      db.insert(e2eeDeviceListChanges).values({
        userId,
        ulid: generateUlid(),
      }).run()
      notifyUser(userId)
    }
  }

  return c.json({ failures })
})
