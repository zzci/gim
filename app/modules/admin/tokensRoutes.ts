import type { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountTokens, oauthTokens } from '@/db/schema'
import { invalidateAccountToken } from '@/modules/account/tokenCache'
import { invalidateOAuthAccessToken } from '@/oauth/accessTokenCache'
import { getAdminContext, logAdminAction } from './helpers'

export function registerAdminTokensRoutes(adminRoute: Hono) {
  // GET /api/tokens — List tokens
  adminRoute.get('/api/tokens', (c) => {
    const oauthRows = db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.type, 'AccessToken'))
      .all()

    const userTokenRows = db.select().from(accountTokens).all()

    return c.json({ oauth_tokens: oauthRows, user_tokens: userTokenRows })
  })

  // DELETE /api/tokens/:tokenId — Delete token
  adminRoute.delete('/api/tokens/:tokenId', async (c) => {
    const tokenId = c.req.param('tokenId')

    // Try both — delete is idempotent
    db.delete(oauthTokens).where(eq(oauthTokens.id, tokenId)).run()
    db.delete(accountTokens).where(eq(accountTokens.token, tokenId)).run()
    await invalidateAccountToken(tokenId)
    await invalidateOAuthAccessToken(tokenId)

    const { adminUserId, ip } = getAdminContext(c)
    logAdminAction(adminUserId, 'token.revoke', 'token', tokenId, null, ip)

    return c.json({})
  })
}
