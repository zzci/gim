import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accessTokens, users } from '@/db/schema'
import { matrixError } from './errors'

export interface AuthContext {
  userId: string
  deviceId: string
  isGuest: boolean
}

function extractToken(c: Context): string | null {
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7)
  }
  // Also support access_token query parameter (legacy)
  const query = c.req.query('access_token')
  return query ?? null
}

export async function authMiddleware(c: Context, next: Next) {
  const token = extractToken(c)

  if (!token) {
    return matrixError(c, 'M_MISSING_TOKEN', 'Missing access token')
  }

  const result = await db
    .select({
      userId: accessTokens.userId,
      deviceId: accessTokens.deviceId,
      expiresAt: accessTokens.expiresAt,
      isGuest: users.isGuest,
      isDeactivated: users.isDeactivated,
    })
    .from(accessTokens)
    .innerJoin(users, eq(accessTokens.userId, users.id))
    .where(eq(accessTokens.token, token))
    .limit(1)

  const row = result[0]
  if (!row) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown or expired access token', { soft_logout: false })
  }

  if (row.isDeactivated) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  if (row.expiresAt && row.expiresAt < new Date()) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', 'Access token has expired', { soft_logout: true })
  }

  c.set('auth', {
    userId: row.userId,
    deviceId: row.deviceId,
    isGuest: row.isGuest,
  } satisfies AuthContext)

  await next()
}
