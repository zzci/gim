import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { accountData, accounts } from '@/db/schema'

const PROFILE_ACCOUNT_DATA_TYPE = 'org.gim.profile'

function localpartFromUserId(userId: string): string {
  const at = userId.startsWith('@') ? 1 : 0
  const colon = userId.indexOf(':')
  if (colon <= at)
    return userId
  return userId.slice(at, colon)
}

export async function findLocalpartByUpstreamSub(upstreamSub: string): Promise<string | null> {
  const row = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.upstreamSub, upstreamSub))
    .get()

  if (!row)
    return null
  return localpartFromUserId(row.id)
}

export async function provisionUserWithUpstreamSub(
  localpart: string,
  upstreamSub: string,
  serverName: string,
): Promise<{ ok: true, userId: string, localpart: string } | { ok: false, conflictUserId: string }> {
  const userId = `@${localpart}:${serverName}`
  const existing = db
    .select({ id: accounts.id, upstreamSub: accounts.upstreamSub })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()

  if (existing) {
    if (!existing.upstreamSub) {
      db.update(accounts)
        .set({ upstreamSub })
        .where(and(eq(accounts.id, userId), isNull(accounts.upstreamSub)))
        .run()
      return { ok: true, userId, localpart }
    }

    if (existing.upstreamSub !== upstreamSub)
      return { ok: false, conflictUserId: userId }

    return { ok: true, userId, localpart }
  }

  db.insert(accounts).values({ id: userId, displayname: localpart, upstreamSub }).run()
  return { ok: true, userId, localpart }
}

export function isLocalpartAvailableForUpstreamSub(
  localpart: string,
  upstreamSub: string,
  serverName: string,
): boolean {
  const userId = `@${localpart}:${serverName}`
  const existing = db
    .select({ upstreamSub: accounts.upstreamSub })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get()

  if (!existing)
    return true
  if (!existing.upstreamSub || existing.upstreamSub === upstreamSub)
    return true
  return false
}

export function setAccountProfileUsername(userId: string, username: string): void {
  db.update(accounts).set({ displayname: username }).where(eq(accounts.id, userId)).run()
  db.insert(accountData)
    .values({
      userId,
      type: PROFILE_ACCOUNT_DATA_TYPE,
      roomId: '',
      content: {
        displayname: username,
      },
    })
    .onConflictDoUpdate({
      target: [accountData.userId, accountData.type, accountData.roomId],
      set: {
        content: {
          displayname: username,
        },
      },
    })
    .run()
}
