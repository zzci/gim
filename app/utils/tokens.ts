import { randomBytes } from 'node:crypto'
import { serverName } from '@/config'

export function generateAccessToken(): string {
  return randomBytes(32).toString('hex')
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex')
}

export function generateDeviceId(): string {
  return randomBytes(5).toString('base64url').toUpperCase()
}

export function generateEventId(): string {
  const random = randomBytes(16).toString('base64url')
  return `$${random}:${serverName}`
}

export function generateRoomId(): string {
  const random = randomBytes(9).toString('base64url')
  return `!${random}:${serverName}`
}

export function generateMediaId(): string {
  return randomBytes(16).toString('base64url')
}
