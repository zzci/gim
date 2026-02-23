import { eq } from 'drizzle-orm'
import { db } from '../app/db'
import { accounts } from '../app/db/schema'

const userId = Bun.argv[2]
if (!userId) {
  console.error('Usage: bun run admin:create <userId>')
  process.exit(1)
}

const account = db.select().from(accounts).where(eq(accounts.id, userId)).get()
if (!account) {
  console.error(`User ${userId} not found`)
  process.exit(1)
}

db.update(accounts).set({ admin: true }).where(eq(accounts.id, userId)).run()
// eslint-disable-next-line no-console
console.log(`User ${userId} is now an admin`)
