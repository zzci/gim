import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices, e2eeDeviceListChanges } from '@/db/schema'
import { invalidateTrustCache } from '@/models/device'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'
import { deviceUpdateBody, validate } from '@/shared/validation'
import { generateUlid } from '@/utils/tokens'

export const devicePutRoute = new Hono<AuthEnv>()
devicePutRoute.use('/*', authMiddleware)

devicePutRoute.put('/:deviceId', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')
  const body = await c.req.json()

  const v = validate(c, deviceUpdateBody, body)
  if (!v.success)
    return v.response

  const updates: Record<string, unknown> = {}

  if (v.data.display_name !== undefined) {
    updates.displayName = v.data.display_name
  }

  if (v.data.trust_state !== undefined) {
    // Only trusted devices can change trust state
    if (auth.trustState !== 'trusted')
      return matrixError(c, 'M_FORBIDDEN', 'Only trusted devices can change device trust state')

    // Cannot change own trust state
    if (deviceId === auth.deviceId)
      return matrixError(c, 'M_FORBIDDEN', 'Cannot change trust state of current device')

    // Verify target device exists and belongs to the same user
    const target = db.select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))
      .get()

    if (!target)
      return matrixError(c, 'M_NOT_FOUND', 'Device not found')

    updates.trustState = v.data.trust_state
    updates.trustReason = v.data.trust_state === 'blocked' ? 'blocked_by_user' : 'unblocked_by_user'
  }

  if (Object.keys(updates).length > 0) {
    db.update(devices)
      .set(updates)
      .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))
      .run()
  }

  // Emit device list change + invalidate cache when trust state changed
  if (v.data.trust_state !== undefined) {
    await invalidateTrustCache(auth.userId, deviceId)
    db.insert(e2eeDeviceListChanges).values({
      userId: auth.userId,
      ulid: generateUlid(),
    }).run()
    notifyUser(auth.userId)
  }

  return c.json({})
})
