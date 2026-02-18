import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountData, e2eeDeviceKeys, e2eeDeviceListChanges } from '@/db/schema'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { generateUlid } from '@/utils/tokens'
import { accountDataTypeToCrossSigningType, CROSS_SIGNING_ACCOUNT_DATA_TYPES } from './crossSigningHelpers'

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

      const csKeys = db.select({ type: accountData.type, content: accountData.content }).from(accountData).where(and(
        eq(accountData.userId, userId),
        eq(accountData.roomId, ''),
        inArray(accountData.type, CROSS_SIGNING_ACCOUNT_DATA_TYPES),
      )).all()

      let matched = false
      for (const csk of csKeys) {
        const keyData = csk.content as any
        const keys = keyData.keys || {}
        if (Object.keys(keys).some((k: string) => k.includes(keyId) || keyId === k)) {
          const mergedSigs = { ...(keyData.signatures || {}) }
          for (const [sigUserId, sigs] of Object.entries(newSignatures) as [string, Record<string, string>][]) {
            mergedSigs[sigUserId] = { ...(mergedSigs[sigUserId] || {}), ...sigs }
          }
          const keyType = accountDataTypeToCrossSigningType(csk.type)
          if (keyType) {
            db.update(accountData)
              .set({ content: { ...keyData, signatures: mergedSigs } })
              .where(and(
                eq(accountData.userId, userId),
                eq(accountData.roomId, ''),
                eq(accountData.type, csk.type),
              ))
              .run()
            matched = true
            break
          }
        }
      }

      if (!matched) {
        if (!failures[userId])
          failures[userId] = {}
        failures[userId][keyId] = { errcode: 'M_NOT_FOUND', error: 'Key not found' }
      }
    }

    db.insert(e2eeDeviceListChanges).values({
      userId,
      ulid: generateUlid(),
    }).run()
    notifyUser(userId)
  }

  return c.json({ failures })
})
