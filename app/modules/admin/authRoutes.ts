import type { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { setCookie } from 'hono/cookie'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, accountTokens, oauthTokens } from '@/db/schema'

export function registerAdminAuthRoutes(adminRoute: Hono) {
  // POST /api/login — validate token and set httpOnly cookie
  adminRoute.post('/api/login', async (c) => {
    const body = await c.req.json<{ token: string }>()
    const token = body.token?.trim()
    if (!token) {
      return c.json({ error: 'Missing token' }, 400)
    }

    // Validate the token works by checking it against auth stores
    const oauthRow = db.select({ accountId: oauthTokens.accountId, expiresAt: oauthTokens.expiresAt })
      .from(oauthTokens)
      .where(and(eq(oauthTokens.id, `AccessToken:${token}`), eq(oauthTokens.type, 'AccessToken')))
      .get()

    const userTokenRow = !oauthRow
      ? db.select({ userId: accountTokens.userId }).from(accountTokens).where(eq(accountTokens.token, token)).get()
      : null

    if (!oauthRow && !userTokenRow) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    if (oauthRow?.expiresAt && oauthRow.expiresAt.getTime() < Date.now()) {
      return c.json({ error: 'Token expired' }, 401)
    }

    // Resolve userId and check admin flag
    let userId: string
    if (oauthRow) {
      const accountId = oauthRow.accountId!
      userId = accountId.startsWith('@') ? accountId : `@${accountId}:${serverName}`
    }
    else {
      userId = userTokenRow!.userId
    }

    const account = db.select({ admin: accounts.admin }).from(accounts).where(eq(accounts.id, userId)).get()
    if (!account?.admin) {
      return c.json({ error: 'Admin access required' }, 403)
    }

    setCookie(c, 'admin_token', token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/admin',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    })

    return c.json({ ok: true })
  })

  // POST /api/logout — clear the httpOnly cookie
  adminRoute.post('/api/logout', (c) => {
    setCookie(c, 'admin_token', '', {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/admin',
      maxAge: 0,
    })
    return c.json({ ok: true })
  })
}
