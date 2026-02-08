import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { accessTokens } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const logoutRoute = new Hono()

logoutRoute.use('/*', authMiddleware)

// POST /logout - invalidate the current access token
logoutRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext

  // Delete only the current token (find by userId + deviceId match)
  const token = c.req.header('Authorization')?.slice(7)
  if (token) {
    await db.delete(accessTokens).where(eq(accessTokens.token, token))
  }

  return c.json({})
})

// POST /logout/all - invalidate all tokens for the user
logoutRoute.post('/all', async (c) => {
  const auth = c.get('auth') as AuthContext
  await db.delete(accessTokens).where(eq(accessTokens.userId, auth.userId))
  return c.json({})
})
