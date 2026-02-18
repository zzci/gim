import { customAlphabet } from 'nanoid'
import { monotonicFactory } from 'ulid'
import { serverName } from '@/config'

const ulid = monotonicFactory()

// Readable alphabet: no 0/O, 1/l/I confusion
const nanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', 8)
const deviceNanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', 10)

export function generateUlid(): string {
  return ulid()
}

export function generateShortId(): string {
  return nanoid()
}

export function generateDeviceId(): string {
  return deviceNanoid()
}

export function generateEventId(): string {
  return ulid()
}

export function generateRoomId(): string {
  return `!${nanoid()}:${serverName}`
}

export function generateMediaId(): string {
  return ulid()
}
