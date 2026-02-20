import type { Context, Next } from 'hono'
import { matrixError } from '@/shared/middleware/errors'

export type DeviceTrustState = 'trusted' | 'unverified' | 'blocked'

const TO_DEVICE_VERIFICATION_TYPES = new Set([
  'm.key.verification.request',
  'm.key.verification.ready',
  'm.key.verification.start',
  'm.key.verification.accept',
  'm.key.verification.key',
  'm.key.verification.mac',
  'm.key.verification.done',
  'm.key.verification.cancel',
])

export function normalizeDeviceTrustState(value: string | null | undefined): DeviceTrustState {
  if (value === 'trusted' || value === 'unverified' || value === 'blocked') {
    return value
  }
  return 'unverified'
}

export function isTrustedDevice(trustState: DeviceTrustState): boolean {
  return trustState === 'trusted'
}

export function isVerificationToDeviceType(eventType: string): boolean {
  return TO_DEVICE_VERIFICATION_TYPES.has(eventType)
}

// Account data types safe for unverified devices (cross-signing / verification related)
const UNVERIFIED_ACCOUNT_DATA_TYPES = new Set([
  'm.cross_signing.master',
  'm.cross_signing.self_signing',
  'm.cross_signing.user_signing',
  'm.org.matrix.custom.backup_disabled',
])

export function isAccountDataAllowedForUnverified(eventType: string): boolean {
  return UNVERIFIED_ACCOUNT_DATA_TYPES.has(eventType)
}

const UNVERIFIED_ALLOWED_PREFIXES = [
  '/_matrix/client/v3/logout',
  '/_matrix/client/v3/account/whoami',
  '/_matrix/client/v3/sync',
  '/_matrix/client/unstable/org.matrix.simplified_msc3575/sync',
  '/_matrix/client/v3/keys/',
  '/_matrix/client/v3/sendToDevice/',
  '/_matrix/client/v3/pushrules',
]

export function isPathAllowedForUnverifiedDevice(path: string, method: string): boolean {
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

  // Devices: GET only (list + single)
  if (p === '/_matrix/client/v3/devices' || p.startsWith('/_matrix/client/v3/devices/'))
    return method === 'GET'

  // Static prefix whitelist
  for (const prefix of UNVERIFIED_ALLOWED_PREFIXES) {
    if (p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
      return true
  }

  // Account data: only cross-signing types, only under /user/ path
  const adMarker = '/account_data/'
  const adIdx = p.indexOf(adMarker)
  if (adIdx >= 0 && p.startsWith('/_matrix/client/v3/user/')) {
    const type = decodeURIComponent(p.slice(adIdx + adMarker.length))
    return isAccountDataAllowedForUnverified(type)
  }

  return false
}

export async function requireTrustedDevice(c: Context, next: Next) {
  const auth = c.get('auth') as { trustState?: DeviceTrustState }
  if (auth?.trustState !== 'trusted') {
    return matrixError(c, 'M_FORBIDDEN', 'Device is not verified', { errcode_detail: 'M_DEVICE_UNVERIFIED' })
  }
  await next()
}
