import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accounts } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden } from '@/shared/middleware/errors'

export async function adminMiddleware(c: Context, next: Next) {
  // First run standard auth
  await authMiddleware(c, async () => {})

  // Check if auth was set (authMiddleware may have returned an error)
  const auth = c.get('auth') as { userId: string } | undefined
  if (!auth)
    return

  // Check admin flag
  const account = db.select({ admin: accounts.admin }).from(accounts).where(eq(accounts.id, auth.userId)).get()
  if (!account?.admin) {
    return matrixForbidden(c, 'Admin access required')
  }

  await next()
}
