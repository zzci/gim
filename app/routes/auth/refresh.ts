import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accessTokens } from '@/db/schema'
import { generateAccessToken, generateRefreshToken } from '@/utils/tokens'
import { matrixError } from '@/middleware/errors'

export const refreshRoute = new Hono()

// POST /refresh - refresh an access token
refreshRoute.post('/', async (c) => {
  const body = await c.req.json()
  const { refresh_token } = body

  if (!refresh_token) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing refresh_token')
  }

  // Find the token entry by refresh_token
  const existing = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.refreshToken, refresh_token))
    .limit(1)

  if (!existing[0]) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown refresh token')
  }

  const newToken = generateAccessToken()
  const newRefreshToken = generateRefreshToken()

  // Update with new tokens
  await db.update(accessTokens)
    .set({
      token: newToken,
      refreshToken: newRefreshToken,
    })
    .where(eq(accessTokens.refreshToken, refresh_token))

  return c.json({
    access_token: newToken,
    refresh_token: newRefreshToken,
    expires_in_ms: 86400000, // 24 hours
  })
})
