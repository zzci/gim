import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { getCookie } from 'hono/cookie'
import { db } from '@/db'
import { accounts } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden } from '@/shared/middleware/errors'

export async function adminMiddleware(c: Context, next: Next) {
  // Read token from httpOnly cookie, fall back to Authorization header
  const cookieToken = getCookie(c, 'admin_token')
  if (cookieToken && !c.req.header('Authorization')) {
    c.req.raw.headers.set('Authorization', `Bearer ${cookieToken}`)
  }

  // First run standard auth and preserve its response when auth fails
  const authResult = await authMiddleware(c, async () => {})
  if (authResult)
    return authResult

  const auth = c.get('auth') as { userId: string } | undefined
  if (!auth)
    return matrixForbidden(c, 'Authentication required')

  // Check admin flag
  const account = db.select({ admin: accounts.admin }).from(accounts).where(eq(accounts.id, auth.userId)).get()
  if (!account?.admin) {
    return matrixForbidden(c, 'Admin access required')
  }

  await next()
}
