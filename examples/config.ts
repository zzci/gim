/**
 * Shared configuration and helpers for all example scripts.
 */

import { randomBytes } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { MatrixClient } from './client'

// ---- Server ----

export const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'
export const SERVER_NAME = process.env.IM_SERVER_NAME || 'localhost'
export const DB_PATH = process.env.DB_PATH || 'data/gim.db'

// ---- Test Users ----

export const TEST_USERS = [
  { localpart: 'alice', displayname: 'Alice', admin: true },
  { localpart: 'bob', displayname: 'Bob', admin: false },
] as const

// ---- Token File ----

export const TOKENS_PATH = new URL('.tokens.json', import.meta.url).pathname

export interface TokenInfo {
  userId: string
  accessToken: string
  deviceId: string
  refreshToken: string
}

export interface Tokens {
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

// ---- Client Helpers ----

export async function alice(): Promise<MatrixClient> {
  const t = await loadTokens()
  return new MatrixClient(BASE_URL, t.alice.accessToken, t.alice.userId)
}

export async function bob(): Promise<MatrixClient> {
  const t = await loadTokens()
  return new MatrixClient(BASE_URL, t.bob.accessToken, t.bob.userId)
}

// ---- Extra Device Login ----

/**
 * Login as a user with a new device. Issues a LoginToken directly in the DB,
 * then exchanges it via POST /login. Returns a MatrixClient + deviceId.
 */
export async function loginNewDevice(localpart: string, deviceName: string): Promise<{ client: MatrixClient, deviceId: string }> {
  const { oauthTokens } = await import('../app/db/schema')
  const sqlite = new Database(DB_PATH)
  const db = drizzle({ client: sqlite })

  const loginJti = randomBytes(32).toString('hex')
  db.insert(oauthTokens).values({
    id: `LoginToken:${loginJti}`,
    type: 'LoginToken',
    accountId: localpart,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }).run()
  sqlite.close()

  const res = await fetch(`${BASE_URL}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.token',
      token: loginJti,
      initial_device_display_name: deviceName,
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Login failed for ${localpart}: ${JSON.stringify(err)}`)
  }

  const data = await res.json() as {
    user_id: string
    access_token: string
    device_id: string
  }

  return {
    client: new MatrixClient(BASE_URL, data.access_token, data.user_id),
    deviceId: data.device_id,
  }
}
