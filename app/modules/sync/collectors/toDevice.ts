import { and, asc, eq, gt, lte } from 'drizzle-orm'
import { db } from '@/db'
import { devices, e2eeToDeviceMessages } from '@/db/schema'
import { isVerificationToDeviceType } from '@/shared/middleware/deviceTrust'

export interface ToDeviceResult {
  events: Array<{ type: string, sender: string, content: Record<string, unknown> }>
  maxDeliveredId: number
}

/**
 * Collect pending to-device messages for a device.
 * Runs inside a transaction for atomicity: cleans up previously delivered
 * messages (on incremental sync) and fetches new ones in a single pass.
 */
export function collectToDeviceMessages(
  userId: string,
  deviceId: string,
  isTrusted: boolean,
  isIncremental: boolean,
): ToDeviceResult {
  return db.transaction((tx) => {
    const device = tx.select({ lastToDeviceStreamId: devices.lastToDeviceStreamId })
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
      .get()

    const lastDeliveredId = device?.lastToDeviceStreamId ?? 0

    // If incremental sync, the client confirmed it received the previous response
    // -> safe to delete previously delivered messages
    if (isIncremental && lastDeliveredId > 0) {
      tx.delete(e2eeToDeviceMessages)
        .where(and(
          eq(e2eeToDeviceMessages.userId, userId),
          eq(e2eeToDeviceMessages.deviceId, deviceId),
          lte(e2eeToDeviceMessages.id, lastDeliveredId),
        ))
        .run()
    }

    // Fetch pending to-device messages (ordered by auto-increment id)
    const msgs = tx.select().from(e2eeToDeviceMessages).where(and(
      eq(e2eeToDeviceMessages.userId, userId),
      eq(e2eeToDeviceMessages.deviceId, deviceId),
      gt(e2eeToDeviceMessages.id, lastDeliveredId),
    )).orderBy(asc(e2eeToDeviceMessages.id)).all()

    // Untrusted devices only see verification-related messages
    const visibleMsgs = isTrusted
      ? msgs
      : msgs.filter(m => isVerificationToDeviceType(m.type))

    const events = visibleMsgs.map(m => ({
      type: m.type,
      sender: m.sender,
      content: m.content,
    }))

    // Track the max auto-increment id we're actually delivering (visible only).
    // Using the unfiltered list would skip non-verification messages that arrive
    // during the trust-transition window (between DB promotion and next full sync).
    let maxDeliveredId = 0
    if (visibleMsgs.length > 0) {
      maxDeliveredId = visibleMsgs[visibleMsgs.length - 1]!.id
      tx.update(devices)
        .set({ lastToDeviceStreamId: maxDeliveredId })
        .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
        .run()
    }

    return { events, maxDeliveredId }
  })
}
