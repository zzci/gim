/**
 * Test helpers: shared client setup for all test suites.
 * Assumes the server is running (bun dev) and examples/setup.ts has been run.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { devices } from '@/db/schema'
import { MatrixClient } from '../examples/client'

const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'
const TOKENS_PATH = new URL('../examples/.tokens.json', import.meta.url).pathname

interface TokenInfo {
  userId: string
  accessToken: string
  deviceId: string
}

interface Tokens {
  alice: TokenInfo
  bob: TokenInfo
}

let _tokens: Tokens | null = null

export async function loadTokens(): Promise<Tokens> {
  if (_tokens)
    return _tokens
  _tokens = await Bun.file(TOKENS_PATH).json() as Tokens
  return _tokens
}

function ensureTrusted(userId: string, deviceId: string) {
  db.update(devices)
    .set({ trustState: 'trusted' })
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .run()
}

export async function getAlice(): Promise<MatrixClient> {
  const t = await loadTokens()
  ensureTrusted(t.alice.userId, t.alice.deviceId)
  return new MatrixClient(BASE_URL, t.alice.accessToken, t.alice.userId)
}

export async function getBob(): Promise<MatrixClient> {
  const t = await loadTokens()
  ensureTrusted(t.bob.userId, t.bob.deviceId)
  return new MatrixClient(BASE_URL, t.bob.accessToken, t.bob.userId)
}

/** Unique transaction ID */
export function txnId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
