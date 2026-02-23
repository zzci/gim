import { serverName } from '@/config'
import { getAccountToken } from '@/modules/account/tokenCache'
import { getOAuthAccessToken } from '@/oauth/accessTokenCache'

export function getRoomId(c: any): string {
  return c.req.param('roomId') || ''
}

// Try to extract userId from token without failing on missing/invalid auth
export async function tryExtractUserId(c: any): Promise<string | undefined> {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : c.req.query('access_token')
  if (!token)
    return undefined

  const oauthRow = await getOAuthAccessToken(token)
  if (oauthRow?.accountId) {
    return oauthRow.accountId.startsWith('@') ? oauthRow.accountId : `@${oauthRow.accountId}:${serverName}`
  }

  const userToken = await getAccountToken(token)
  return userToken?.userId
}
