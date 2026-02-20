import type { MatrixErrorCode } from '@/shared/middleware/errors'
import { getAccountToken } from '@/modules/account/tokenCache'
import { getRegistrationByAsToken, isUserInNamespace } from '@/modules/appservice/config'
import { getOAuthAccessToken } from '@/oauth/accessTokenCache'

export type TokenSource = 'appservice' | 'oauth' | 'account'

export interface ResolvedToken {
  source: TokenSource
  userId: string
  deviceId: string
  isGuest: boolean
  /** OAuth-specific: token row for expiration/consumption checks */
  oauthExpiresAt?: Date | null
  oauthConsumedAt?: Date | null
  oauthTokenId?: string
  /** Whether deviceId was backfilled (missing on token, needs DB update) */
  deviceIdBackfilled?: boolean
}

export interface AppServiceResolvedToken extends ResolvedToken {
  source: 'appservice'
  senderLocalpart: string
}

/**
 * Resolve a bearer token to its source and associated identity.
 * Delegates to: AppService tokens → OAuth tokens → Account tokens.
 */
export async function resolveToken(
  bearer: string,
  srvName: string,
  queryUserId?: string,
): Promise<ResolvedToken | { error: string, errorCode: MatrixErrorCode, extra?: Record<string, unknown> } | null> {
  // 1. AppService tokens
  const asReg = getRegistrationByAsToken(bearer)
  if (asReg) {
    let userId: string
    if (queryUserId) {
      if (!isUserInNamespace(queryUserId, asReg)) {
        return { error: 'User is not in appservice namespace', errorCode: 'M_FORBIDDEN' }
      }
      userId = queryUserId
    }
    else {
      userId = `@${asReg.senderLocalpart}:${srvName}`
    }
    return {
      source: 'appservice',
      userId,
      deviceId: 'APPSERVICE',
      isGuest: false,
      senderLocalpart: asReg.senderLocalpart,
    } as AppServiceResolvedToken
  }

  // 2. OAuth tokens
  const oauthRow = await getOAuthAccessToken(bearer)
  if (oauthRow) {
    if (oauthRow.expiresAt && oauthRow.expiresAt.getTime() < Date.now()) {
      return { error: 'Access token has expired', errorCode: 'M_UNKNOWN_TOKEN', extra: { soft_logout: true } }
    }
    if (oauthRow.consumedAt) {
      return { error: 'Access token has been consumed', errorCode: 'M_UNKNOWN_TOKEN', extra: { soft_logout: false } }
    }
    const accountId = oauthRow.accountId
    if (!accountId) {
      return { error: 'Invalid token: missing accountId', errorCode: 'M_UNKNOWN_TOKEN', extra: { soft_logout: false } }
    }
    const userId = accountId.startsWith('@') ? accountId : `@${accountId}:${srvName}`
    const deviceId = oauthRow.deviceId ?? null
    const backfilled = !deviceId

    return {
      source: 'oauth',
      userId,
      deviceId: deviceId ?? '', // caller must generate if empty
      isGuest: false,
      oauthTokenId: oauthRow.id,
      deviceIdBackfilled: backfilled,
    }
  }

  // 3. Account tokens (long-lived bot tokens)
  const accountToken = await getAccountToken(bearer)
  if (accountToken) {
    return {
      source: 'account',
      userId: accountToken.userId,
      deviceId: accountToken.deviceId,
      isGuest: false,
    }
  }

  return null
}

export async function invalidateToken(bearer: string): Promise<void> {
  const { invalidateOAuthAccessToken } = await import('@/oauth/accessTokenCache')
  const { invalidateAccountToken } = await import('@/modules/account/tokenCache')
  await invalidateOAuthAccessToken(bearer)
  await invalidateAccountToken(bearer)
}
