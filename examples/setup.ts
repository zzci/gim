/**
 * Bootstrap: create test users (alice, bob), set alice as admin,
 * issue login tokens, exchange for access tokens, write .tokens.json.
 *
 * Usage: bun run examples/setup.ts
 */

import type { TokenInfo } from './config'
import { randomBytes } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { accounts, oauthTokens } from '../app/db/schema'
import { BASE_URL, DB_PATH, SERVER_NAME, TEST_USERS, TOKENS_PATH } from './config'

async function main() {
  console.log('--- gim examples: setup ---')
  console.log(`Server: ${BASE_URL}`)
  console.log(`DB: ${DB_PATH}`)

  // Connect to SQLite directly
  const sqlite = new Database(DB_PATH)
  const db = drizzle({ client: sqlite })

  for (const u of TEST_USERS) {
    const userId = `@${u.localpart}:${SERVER_NAME}`

    // Upsert account
    const existing = db.select().from(accounts).where(eq(accounts.id, userId)).get()
    if (!existing) {
      db.insert(accounts).values({ id: userId, admin: u.admin, displayname: u.displayname }).run()
      console.log(`Created user ${userId} (admin=${u.admin})`)
    }
    else {
      db.update(accounts).set({ admin: u.admin, displayname: u.displayname }).where(eq(accounts.id, userId)).run()
      console.log(`Updated user ${userId} (admin=${u.admin})`)
    }
  }

  // Issue login tokens and exchange for access tokens
  const tokens: Record<string, TokenInfo> = {}

  for (const u of TEST_USERS) {
    const loginJti = randomBytes(32).toString('hex')
    db.insert(oauthTokens).values({
      id: `LoginToken:${loginJti}`,
      type: 'LoginToken',
      accountId: u.localpart,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }).run()

    console.log(`Issued LoginToken for ${u.localpart}`)

    // Exchange via POST /login
    const res = await fetch(`${BASE_URL}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.token',
        token: loginJti,
        initial_device_display_name: `${u.displayname} Test Device`,
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      console.error(`Login failed for ${u.localpart}:`, err)
      process.exit(1)
    }

    const data = await res.json() as {
      user_id: string
      access_token: string
      device_id: string
      refresh_token: string
    }

    tokens[u.localpart] = {
      userId: data.user_id,
      accessToken: data.access_token,
      deviceId: data.device_id,
      refreshToken: data.refresh_token,
    }

    console.log(`Login OK: ${data.user_id} (device: ${data.device_id})`)
  }

  // Write tokens file
  await Bun.write(TOKENS_PATH, JSON.stringify(tokens, null, 2))
  console.log(`\nTokens written to ${TOKENS_PATH}`)

  sqlite.close()
  console.log('\n--- setup complete ---')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
