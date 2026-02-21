import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeToDeviceMessages } from '@/db/schema'
import { invalidateTrustCache } from '@/models/device'
import { clearVerificationSession, isVerificationExpired, trackVerificationRequest } from '@/modules/e2ee/verificationSessions'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { isVerificationToDeviceType } from '@/shared/middleware/deviceTrust'
import { matrixError } from '@/shared/middleware/errors'

export const sendToDeviceRoute = new Hono<AuthEnv>()
sendToDeviceRoute.use('/*', authMiddleware)

sendToDeviceRoute.put('/:eventType/:txnId', async (c) => {
  const auth = c.get('auth')
  const eventType = c.req.param('eventType')
  const body = await c.req.json()
  const messages = body.messages || {}

  const verificationEvent = isVerificationToDeviceType(eventType)
  if (auth.trustState !== 'trusted' && !verificationEvent) {
    return matrixError(c, 'M_FORBIDDEN', 'Device is not verified', { errcode_detail: 'M_DEVICE_UNVERIFIED' })
  }

  // Verification session timeout tracking
  if (verificationEvent) {
    // Extract transaction_id from the first message content
    const firstContent = Object.values(messages as Record<string, Record<string, any>>)[0]
    const firstDevice = firstContent ? Object.values(firstContent)[0] : null
    const transactionId = firstDevice?.transaction_id as string | undefined

    if (transactionId) {
      if (eventType === 'm.key.verification.request') {
        const firstTargetUser = Object.keys(messages)[0]
        if (firstTargetUser)
          trackVerificationRequest(transactionId, auth.userId, firstTargetUser)
      }
      else if (eventType === 'm.key.verification.done' || eventType === 'm.key.verification.cancel') {
        clearVerificationSession(transactionId)
      }
      else if (isVerificationExpired(transactionId)) {
        // Drop expired verification events silently
        logger.debug('verification_session_expired', { transactionId, eventType })
        return c.json({})
      }
    }
  }

  const notifiedUsers = new Set<string>()

  for (const [userId, deviceMap] of Object.entries(messages) as [string, Record<string, any>][]) {
    for (const [deviceId, content] of Object.entries(deviceMap)) {
      if (deviceId === '*') {
        const userDevices = db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId)).all()

        for (const d of userDevices) {
          const target = db.select({ trustState: devices.trustState })
            .from(devices)
            .where(and(eq(devices.userId, userId), eq(devices.id, d.id)))
            .get()
          // Skip blocked devices entirely (including verification events)
          if (target?.trustState === 'blocked')
            continue
          if (target?.trustState === 'unverified' && !verificationEvent)
            continue

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

      const target = db.select({ trustState: devices.trustState })
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
        .get()
      // Skip blocked devices entirely (including verification events)
      if (target?.trustState === 'blocked')
        continue
      if (target?.trustState === 'unverified' && !verificationEvent)
        continue

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

  // V1 trust promotion: a trusted device can unlock another device after successful verification done.
  if (eventType === 'm.key.verification.done' && auth.trustState === 'trusted') {
    for (const [targetUserId, deviceMap] of Object.entries(messages) as [string, Record<string, any>][]) {
      if (targetUserId !== auth.userId)
        continue
      for (const targetDeviceId of Object.keys(deviceMap)) {
        if (targetDeviceId === '*' || targetDeviceId === auth.deviceId)
          continue
        db.update(devices)
          .set({
            trustState: 'trusted',
            trustReason: 'verification_done',
            verifiedAt: new Date(),
            verifiedByDeviceId: auth.deviceId,
          })
          .where(and(
            eq(devices.userId, auth.userId),
            eq(devices.id, targetDeviceId),
            eq(devices.trustState, 'unverified'),
          ))
          .run()
        await invalidateTrustCache(auth.userId, targetDeviceId)

        // Wake newly verified device so it re-syncs with trusted access
        notifyUser(auth.userId)
      }
    }
  }

  return c.json({})
})
