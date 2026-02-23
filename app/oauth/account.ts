import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accounts } from '@/db/schema'

export async function provisionUser(localpart: string, serverName: string): Promise<string> {
  const userId = `@${localpart}:${serverName}`

  const existing = db.select().from(accounts).where(eq(accounts.id, userId)).get()
  if (!existing) {
    await db.insert(accounts).values({ id: userId, displayname: localpart })
  }

  return userId
}
