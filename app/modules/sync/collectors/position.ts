import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { devices } from '@/db/schema'
import { getMaxEventId } from '@/shared/helpers/eventQueries'

/**
 * Compute the next_batch token from all stream heads.
 * Takes the lexicographic maximum of the event stream head
 * and any additional stream heads (device list ULIDs, account data stream IDs).
 */
export function computeNextBatch(...streamHeads: string[]): string {
  let next = getMaxEventId()
  for (const head of streamHeads) {
    if (head > next) {
      next = head
    }
  }
  return next || '0'
}

/**
 * Persist the sync position for a device.
 * Only trusted devices have their lastSyncBatch persisted — untrusted syncs
 * return no rooms/account data, so their position is meaningless for recovery.
 * Keeping it null lets us detect the first trusted sync (trust transition).
 */
export function persistSyncPosition(
  userId: string,
  deviceId: string,
  isTrusted: boolean,
  nextBatch: string,
): void {
  if (!isTrusted) {
    return
  }

  db.update(devices)
    .set({ lastSyncBatch: nextBatch })
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .run()
}

/**
 * Get the last persisted sync batch for a device.
 */
export function getDeviceLastSyncBatch(userId: string, deviceId: string): string | null {
  const device = db.select({ lastSyncBatch: devices.lastSyncBatch })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()
  return device?.lastSyncBatch ?? null
}
