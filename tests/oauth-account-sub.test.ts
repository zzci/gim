import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountData, accounts } from '@/db/schema'
import {
  findLocalpartByUpstreamSub,
  provisionUserWithUpstreamSub,
  setAccountProfileUsername,
} from '@/oauth/account'

describe('oauth upstream sub mapping', () => {
  test('finds existing localpart by upstream sub', async () => {
    const suffix = `${Date.now()}a`
    const localpart = `submap_${suffix}`
    const upstreamSub = `sub-${suffix}`
    const userId = `@${localpart}:localhost`

    db.insert(accounts).values({ id: userId, displayname: localpart, upstreamSub }).run()

    try {
      const found = await findLocalpartByUpstreamSub(upstreamSub)
      expect(found).toBe(localpart)
    }
    finally {
      db.delete(accounts).where(eq(accounts.id, userId)).run()
    }
  })

  test('returns conflict when local username is occupied by another sub', async () => {
    const suffix = `${Date.now()}b`
    const localpart = `subconflict_${suffix}`
    const userId = `@${localpart}:localhost`

    db.insert(accounts).values({
      id: userId,
      displayname: localpart,
      upstreamSub: `sub-old-${suffix}`,
    }).run()

    try {
      const result = await provisionUserWithUpstreamSub(localpart, `sub-new-${suffix}`, 'localhost')
      expect(result.ok).toBe(false)
    }
    finally {
      db.delete(accounts).where(eq(accounts.id, userId)).run()
    }
  })

  test('stores displayname under accountData content.displayname only', async () => {
    const suffix = `${Date.now()}c`
    const localpart = `profile_${suffix}`
    const userId = `@${localpart}:localhost`
    const username = `profile_name_${suffix}`

    db.insert(accounts).values({ id: userId, upstreamSub: `sub-profile-${suffix}` }).run()

    try {
      setAccountProfileUsername(userId, username)
      const row = db
        .select({ content: accountData.content })
        .from(accountData)
        .where(eq(accountData.userId, userId))
        .get()
      expect(row?.content?.displayname).toBe(username)
      expect('username' in (row?.content || {})).toBe(false)
    }
    finally {
      db.delete(accountData).where(eq(accountData.userId, userId)).run()
      db.delete(accounts).where(eq(accounts.id, userId)).run()
    }
  })
})
