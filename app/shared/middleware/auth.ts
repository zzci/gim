import type { Context, Next } from 'hono'
import { and, eq } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, accountTokens, devices, oauthTokens } from '@/db/schema'
import { matrixError } from './errors'

export interface AuthContext {
  userId: string
  deviceId: string
  isGuest: boolean
}

export interface AuthEnv {
  Variables: {
    auth: AuthContext
  }
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

  // Try OAuth tokens first
  const row = db.select().from(oauthTokens).where(
    and(
      eq(oauthTokens.id, `AccessToken:${token}`),
      eq(oauthTokens.type, 'AccessToken'),
    ),
  ).get()

  let userId: string
  let deviceId: string

  if (row) {
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return matrixError(c, 'M_UNKNOWN_TOKEN', 'Access token has expired', { soft_logout: true })
    }
    if (row.consumedAt) {
      return matrixError(c, 'M_UNKNOWN_TOKEN', 'Access token has been consumed', { soft_logout: false })
    }
    const accountId = row.accountId
    if (!accountId) {
      return matrixError(c, 'M_UNKNOWN_TOKEN', 'Invalid token: missing accountId', { soft_logout: false })
    }
    userId = accountId.startsWith('@') ? accountId : `@${accountId}:${serverName}`
    deviceId = row.deviceId || 'OIDC_DEVICE'
  }
  else {
    // Fall back to user tokens (long-lived bot tokens)
    const userToken = db.select().from(accountTokens).where(eq(accountTokens.token, token)).get()
    if (!userToken) {
      return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown or expired access token', { soft_logout: false })
    }
    userId = userToken.userId
    deviceId = userToken.deviceId

    // Update lastUsedAt
    db.update(accountTokens).set({ lastUsedAt: new Date() }).where(eq(accountTokens.token, token)).run()
  }

  // Check account exists and is active
  const account = db.select().from(accounts).where(eq(accounts.id, userId)).get()
  if (account?.isDeactivated) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  // Ensure device exists — needed for to-device delivery, keys/query, sync
  db.insert(devices).values({
    userId,
    id: deviceId,
    ipAddress: c.req.header('x-forwarded-for') || null,
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [devices.userId, devices.id],
    set: {
      lastSeenAt: new Date(),
      ipAddress: c.req.header('x-forwarded-for') || null,
    },
  }).run()

  c.set('auth', { userId, deviceId, isGuest: false } as AuthContext)
  await next()
}
