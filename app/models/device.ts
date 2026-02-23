import type { DeviceTrustState } from '@/shared/middleware/deviceTrust'
import { and, desc, eq } from 'drizzle-orm'
import { cacheDel, cacheGet, cacheSet } from '@/cache'
import { db } from '@/db'
import { accountDataCrossSigning, devices } from '@/db/schema'
import { normalizeDeviceTrustState } from '@/shared/middleware/deviceTrust'

const DEVICE_UPDATE_INTERVAL = 5 * 60 * 1000 // 5 minutes
const TRUST_CACHE_TTL = 300 // 5 minutes in seconds
const MAX_DEVICE_THROTTLE_ENTRIES = 10_000

const deviceLastUpdated = new Map<string, number>()

// Periodic cleanup of stale deviceLastUpdated entries
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [key, ts] of deviceLastUpdated) {
    if (ts < cutoff)
      deviceLastUpdated.delete(key)
  }
}, 10 * 60 * 1000)
cleanupTimer.unref()

export type DeviceRow = typeof devices.$inferSelect

/** Resolve trust state for a device (cached, 5min TTL). */
export async function getTrustState(userId: string, deviceId: string): Promise<{ trustState: DeviceTrustState, existingDevice: { trustState: string | null } | undefined }> {
  const cacheKey = `m:dt:${userId}:${deviceId}`
  const cached = await cacheGet<DeviceTrustState>(cacheKey)
  if (cached !== null) {
    return { trustState: cached, existingDevice: undefined }
  }

  const existingDevice = db.select({ trustState: devices.trustState })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()

  let trustState: DeviceTrustState
  if (existingDevice) {
    trustState = normalizeDeviceTrustState(existingDevice.trustState)
  }
  else {
    const anyDevice = db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId)).limit(1).get()
    const hasCrossSigningKeys = !anyDevice && !!db.select({ userId: accountDataCrossSigning.userId })
      .from(accountDataCrossSigning)
      .where(and(eq(accountDataCrossSigning.userId, userId), eq(accountDataCrossSigning.keyType, 'master')))
      .get()
    trustState = !anyDevice && !hasCrossSigningKeys ? 'trusted' : 'unverified'
  }
  await cacheSet(cacheKey, trustState, { ttl: TRUST_CACHE_TTL })
  return { trustState, existingDevice }
}

/** Get a single device by userId + deviceId. */
export function getDevice(userId: string, deviceId: string): DeviceRow | undefined {
  return db.select()
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()
}

/** List all devices for a user, ordered by lastSeenAt desc. */
export function listDevices(userId: string): DeviceRow[] {
  return db.select()
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(desc(devices.lastSeenAt), desc(devices.createdAt))
    .all()
}

/** Get last persisted sync batch for a device. */
export function getLastSyncBatch(userId: string, deviceId: string): string | null {
  const device = db.select({ lastSyncBatch: devices.lastSyncBatch })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()
  return device?.lastSyncBatch ?? null
}

/**
 * Ensure a device record exists, throttled to one write per DEVICE_UPDATE_INTERVAL.
 * Returns true if a write was performed.
 */
export function ensureDevice(
  userId: string,
  deviceId: string,
  trustState: DeviceTrustState,
  trustReason: string,
  ipAddress: string | null,
): boolean {
  const deviceKey = `${userId}:${deviceId}`
  const now = Date.now()
  const lastUpdated = deviceLastUpdated.get(deviceKey) || 0
  if (now - lastUpdated <= DEVICE_UPDATE_INTERVAL) {
    return false
  }

  db.insert(devices).values({
    userId,
    id: deviceId,
    trustState,
    trustReason,
    ipAddress,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [devices.userId, devices.id],
    set: {
      lastSeenAt: new Date(),
      ipAddress,
    },
  }).run()

  // Cap the throttle map to prevent unbounded growth
  if (deviceLastUpdated.size >= MAX_DEVICE_THROTTLE_ENTRIES) {
    let oldestKey: string | undefined
    let oldestTs = Infinity
    for (const [k, ts] of deviceLastUpdated) {
      if (ts < oldestTs) {
        oldestTs = ts
        oldestKey = k
      }
    }
    if (oldestKey)
      deviceLastUpdated.delete(oldestKey)
  }

  deviceLastUpdated.set(deviceKey, now)
  return true
}

/** Invalidate trust cache for a specific device. */
export async function invalidateTrustCache(userId: string, deviceId: string): Promise<void> {
  await cacheDel(`m:dt:${userId}:${deviceId}`)
}
