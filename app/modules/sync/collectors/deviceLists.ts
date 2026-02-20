import { and, count, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import {
  e2eeDeviceListChanges,
  e2eeFallbackKeys,
  e2eeOneTimeKeys,
} from '@/db/schema'

export interface DeviceListResult {
  changed: string[]
  left: string[]
  maxUlid: string
}

export interface E2eeKeyCountsResult {
  otkCount: number
  fallbackKeyAlgorithms: string[]
}

/**
 * Collect device list changes since the given sync position.
 * Untrusted devices only see their own device changes.
 */
export function collectDeviceListChanges(
  userId: string,
  isTrusted: boolean,
  since: string | null,
): DeviceListResult {
  if (since === null) {
    return { changed: [], left: [], maxUlid: '' }
  }

  const changeConditions = [gt(e2eeDeviceListChanges.ulid, since)]
  if (!isTrusted) {
    changeConditions.push(eq(e2eeDeviceListChanges.userId, userId))
  }

  const changes = db.select({
    userId: e2eeDeviceListChanges.userId,
    ulid: e2eeDeviceListChanges.ulid,
  }).from(e2eeDeviceListChanges).where(and(...changeConditions)).all()

  const changed = [...new Set(changes.map(c => c.userId))]
  let maxUlid = ''
  if (changes.length > 0) {
    maxUlid = changes.reduce((max, c) => c.ulid > max ? c.ulid : max, '')
  }

  return { changed, left: [], maxUlid }
}

/**
 * Query current OTK count and fallback key algorithms for a device.
 * Not affected by trust state.
 */
export function collectE2eeKeyCounts(
  userId: string,
  deviceId: string,
): E2eeKeyCountsResult {
  const otkResult = db.select({ cnt: count() }).from(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, userId),
    eq(e2eeOneTimeKeys.deviceId, deviceId),
    eq(e2eeOneTimeKeys.claimed, false),
  )).get()

  const fallbackKeyAlgorithms = db.select({ algorithm: e2eeFallbackKeys.algorithm })
    .from(e2eeFallbackKeys)
    .where(and(
      eq(e2eeFallbackKeys.userId, userId),
      eq(e2eeFallbackKeys.deviceId, deviceId),
      eq(e2eeFallbackKeys.used, false),
    ))
    .all()
    .map(r => r.algorithm)

  return {
    otkCount: otkResult?.cnt ?? 0,
    fallbackKeyAlgorithms,
  }
}
