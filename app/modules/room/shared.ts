import { and, eq } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { accountTokens, oauthTokens } from '@/db/schema'

export function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

// Try to extract userId from token without failing on missing/invalid auth
export function tryExtractUserId(c: any): string | undefined {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : c.req.query('access_token')
  if (!token)
    return undefined

  const oauthRow = db.select({ accountId: oauthTokens.accountId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.id, `AccessToken:${token}`), eq(oauthTokens.type, 'AccessToken')))
    .get()
  if (oauthRow?.accountId) {
    return oauthRow.accountId.startsWith('@') ? oauthRow.accountId : `@${oauthRow.accountId}:${serverName}`
  }

  const userToken = db.select({ userId: accountTokens.userId })
    .from(accountTokens)
    .where(eq(accountTokens.token, token))
    .get()
  return userToken?.userId
}
