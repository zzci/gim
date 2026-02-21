import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountDataCrossSigning, devices, e2eeDeviceKeys, e2eeDeviceListChanges } from '@/db/schema'
import { invalidateTrustCache } from '@/models/device'
import { notifyUser } from '@/modules/sync/notifier'
import { verifyEd25519Signature } from '@/shared/helpers/verifyKeys'
import { authMiddleware } from '@/shared/middleware/auth'
import { generateUlid } from '@/utils/tokens'

/**
 * Check if incoming signatures contain any entries not already present
 * in the existing signature map. Short-circuits on first new entry.
 */
function hasNewSignatures(
  existing: Record<string, Record<string, string>>,
  incoming: Record<string, Record<string, string>>,
): boolean {
  for (const [sigUserId, sigs] of Object.entries(incoming)) {
    const existingForUser = existing[sigUserId]
    if (!existingForUser)
      return true
    for (const [keyId, value] of Object.entries(sigs)) {
      if (existingForUser[keyId] !== value)
        return true
    }
  }
  return false
}

export const signaturesUploadRoute = new Hono<AuthEnv>()
signaturesUploadRoute.use('/*', authMiddleware)

signaturesUploadRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const failures: Record<string, Record<string, any>> = {}

  for (const [userId, keyMap] of Object.entries(body) as [string, Record<string, any>][]) {
    // Cross-user signatures: allow signing target's master key with auth user's user-signing key
    if (userId !== auth.userId) {
      if (!failures[userId])
        failures[userId] = {}

      // Look up auth user's user-signing key
      const userSigningKey = db.select({ keyData: accountDataCrossSigning.keyData })
        .from(accountDataCrossSigning)
        .where(and(
          eq(accountDataCrossSigning.userId, auth.userId),
          eq(accountDataCrossSigning.keyType, 'user_signing'),
        ))
        .get()

      if (!userSigningKey) {
        for (const keyId of Object.keys(keyMap)) {
          failures[userId][keyId] = { errcode: 'M_FORBIDDEN', error: 'No user-signing key available' }
        }
        continue
      }

      // Look up target user's master key
      const targetMasterKey = db.select({
        keyType: accountDataCrossSigning.keyType,
        keyData: accountDataCrossSigning.keyData,
      })
        .from(accountDataCrossSigning)
        .where(and(
          eq(accountDataCrossSigning.userId, userId),
          eq(accountDataCrossSigning.keyType, 'master'),
        ))
        .get()

      let crossUserChanged = false
      for (const [keyId, signedObject] of Object.entries(keyMap)) {
        if (!targetMasterKey) {
          failures[userId][keyId] = { errcode: 'M_NOT_FOUND', error: 'Target master key not found' }
          continue
        }

        const targetKeys = (targetMasterKey.keyData as any).keys || {}
        const matchesTarget = Object.keys(targetKeys).some((k: string) =>
          k === keyId || k === `ed25519:${keyId}` || keyId === `ed25519:${k.split(':').pop()}`,
        )

        if (!matchesTarget) {
          failures[userId][keyId] = { errcode: 'M_NOT_FOUND', error: 'Key not found' }
          continue
        }

        const newSignatures = (signedObject.signatures || {}) as Record<string, Record<string, string>>
        const existingSigs = ((targetMasterKey.keyData as any).signatures || {}) as Record<string, Record<string, string>>

        if (!hasNewSignatures(existingSigs, newSignatures))
          continue

        const mergedSigs = { ...existingSigs }
        for (const [sigUserId, sigs] of Object.entries(newSignatures)) {
          mergedSigs[sigUserId] = { ...(mergedSigs[sigUserId] || {}), ...sigs }
        }

        db.update(accountDataCrossSigning)
          .set({ keyData: { ...targetMasterKey.keyData as any, signatures: mergedSigs } })
          .where(and(
            eq(accountDataCrossSigning.userId, userId),
            eq(accountDataCrossSigning.keyType, 'master'),
          ))
          .run()
        logger.debug('signatures_upload_cross_user_master_key', { fromUser: auth.userId, targetUser: userId, keyId })
        crossUserChanged = true
      }

      if (crossUserChanged) {
        db.insert(e2eeDeviceListChanges).values({
          userId,
          ulid: generateUlid(),
        }).run()
        notifyUser(userId)
      }
      continue
    }

    let anyChanged = false
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
        const existingSigs = dk.signatures as Record<string, Record<string, string>>
        if (!hasNewSignatures(existingSigs, newSignatures as Record<string, Record<string, string>>)) {
          continue
        }

        const merged = { ...existingSigs }
        for (const [sigUserId, sigs] of Object.entries(newSignatures) as [string, Record<string, string>][]) {
          merged[sigUserId] = { ...(merged[sigUserId] || {}), ...sigs }
        }

        db.update(e2eeDeviceKeys)
          .set({ signatures: merged })
          .where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, dk.deviceId)))
          .run()
        logger.debug('signatures_upload_applied_device_key', { userId, keyId, matchedDeviceId: dk.deviceId })

        // Check if this is a self-signing key signature on the user's own device
        // If valid, promote the device to trusted (allows recovery via private key import)
        if (userId === auth.userId) {
          const selfSigningKey = db.select({ keyData: accountDataCrossSigning.keyData })
            .from(accountDataCrossSigning)
            .where(and(
              eq(accountDataCrossSigning.userId, userId),
              eq(accountDataCrossSigning.keyType, 'self_signing'),
            ))
            .get()

          if (selfSigningKey) {
            const ssKeys = (selfSigningKey.keyData as any).keys as Record<string, string> | undefined
            if (ssKeys) {
              const ssKeyEntry = Object.entries(ssKeys).find(([k]) => k.startsWith('ed25519:'))
              if (ssKeyEntry) {
                const [ssKeyId, ssPublicKey] = ssKeyEntry
                // Build the full signed device object for verification
                const fullDeviceObj = {
                  user_id: userId,
                  device_id: dk.deviceId,
                  algorithms: dk.algorithms,
                  keys: dk.keys,
                  signatures: merged,
                }
                const sigResult = verifyEd25519Signature(fullDeviceObj, userId, ssKeyId, ssPublicKey)
                if (sigResult.valid) {
                  db.update(devices)
                    .set({
                      trustState: 'trusted',
                      trustReason: 'self_signing_verified',
                      verifiedAt: new Date(),
                      verifiedByDeviceId: auth.deviceId,
                    })
                    .where(and(
                      eq(devices.userId, userId),
                      eq(devices.id, dk.deviceId),
                      eq(devices.trustState, 'unverified'),
                    ))
                    .run()
                  await invalidateTrustCache(userId, dk.deviceId)
                  logger.info('device_trust_promoted_by_self_signing', { userId, deviceId: dk.deviceId })
                  notifyUser(userId)
                }
              }
            }
          }
        }

        anyChanged = true
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
          const existingCsSigs = (keyData.signatures || {}) as Record<string, Record<string, string>>
          if (!hasNewSignatures(existingCsSigs, newSignatures as Record<string, Record<string, string>>)) {
            matched = true
            break
          }

          const mergedSigs = { ...existingCsSigs }
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
          anyChanged = true
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

    if (anyChanged) {
      db.insert(e2eeDeviceListChanges).values({
        userId,
        ulid: generateUlid(),
      }).run()
      notifyUser(userId)
    }
  }

  return c.json({ failures })
})
