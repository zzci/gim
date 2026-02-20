import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { devices } from '@/db/schema'

export interface TrustContext {
  isTrusted: boolean
  /** Effective since ID for rooms/account data. null = initial sync or trust transition (full dataset). */
  trustedSinceId: string | null
  /** True when a device just transitioned from unverified to trusted */
  isTrustTransition: boolean
}

/**
 * Resolve the trust context for a sync request.
 *
 * - Unverified device: trustedSinceId = null, rooms/account data empty
 * - Verified + lastSyncBatch null: trust transition, full dataset
 * - Verified + lastSyncBatch present: normal incremental
 */
export function resolveTrustContext(
  userId: string,
  deviceId: string,
  isTrustedDevice: boolean,
  since: string | null,
): TrustContext {
  if (!isTrustedDevice) {
    return { isTrusted: false, trustedSinceId: null, isTrustTransition: false }
  }

  if (since === null) {
    return { isTrusted: true, trustedSinceId: null, isTrustTransition: false }
  }

  // Trusted + incremental: check if this is the first trusted sync
  const device = db.select({ lastSyncBatch: devices.lastSyncBatch })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()

  if (!device?.lastSyncBatch) {
    // Trust transition: device was just verified, send full dataset
    return { isTrusted: true, trustedSinceId: null, isTrustTransition: true }
  }

  return { isTrusted: true, trustedSinceId: since, isTrustTransition: false }
}
