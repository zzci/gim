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

export async function requireTrustedDevice(c: Context, next: Next) {
  const auth = c.get('auth') as { trustState?: DeviceTrustState }
  if (auth?.trustState !== 'trusted') {
    return matrixError(c, 'M_FORBIDDEN', 'Device is not verified', { errcode_detail: 'M_DEVICE_UNVERIFIED' })
  }
  await next()
}
