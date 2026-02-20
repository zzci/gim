import type { Context, Next } from 'hono'
import type { DeviceTrustState } from '@/shared/middleware/deviceTrust'
import { eq } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { oauthTokens } from '@/db/schema'
import { isDeactivated } from '@/models/account'
import { ensureDevice, getTrustState } from '@/models/device'
import { getAccountToken, markAccountTokenUsed } from '@/modules/account/tokenCache'
import { ensureAppServiceUser, getRegistrationByAsToken, isUserInNamespace } from '@/modules/appservice/config'
import { getOAuthAccessToken } from '@/oauth/accessTokenCache'
import { isPathAllowedForUnverifiedDevice } from '@/shared/middleware/deviceTrust'
import { generateDeviceId } from '@/utils/tokens'
import { matrixError } from './errors'

// Re-exports for backwards compatibility
export { invalidateDeactivatedCache as invalidateAccountStatusCache } from '@/models/account'
export { invalidateTrustCache as invalidateDeviceTrustCache } from '@/models/device'

export interface AuthContext {
  userId: string
  deviceId: string
  isGuest: boolean
  trustState: DeviceTrustState
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
  return null
}

export async function authMiddleware(c: Context, next: Next) {
  const token = extractToken(c)

  if (!token) {
    return matrixError(c, 'M_MISSING_TOKEN', 'Missing access token')
  }

  // Try Application Service tokens first
  const asReg = getRegistrationByAsToken(token)
  if (asReg) {
    const assertUserId = c.req.query('user_id')
    let userId: string

    if (assertUserId) {
      // Validate asserted user is in AS namespace
      if (!isUserInNamespace(assertUserId, asReg)) {
        return matrixError(c, 'M_FORBIDDEN', 'User is not in appservice namespace')
      }
      userId = assertUserId
    }
    else {
      userId = `@${asReg.senderLocalpart}:${serverName}`
    }

    // Auto-create the user account if needed
    ensureAppServiceUser(userId)

    // AS requests skip device tracking
    c.set('auth', { userId, deviceId: 'APPSERVICE', isGuest: false, trustState: 'trusted' } as AuthContext)
    await next()
    return
  }

  // Try OAuth tokens first
  const row = await getOAuthAccessToken(token)

  let userId: string
  let deviceId: string
  let trustState: DeviceTrustState = 'unverified'

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
    if (!row.deviceId) {
      // Backfill legacy OAuth tokens that were issued without device_id.
      logger.warn('oauth_token_missing_device_id', { tokenId: row.id, accountId })
      const generated = generateDeviceId()
      db.update(oauthTokens)
        .set({ deviceId: generated })
        .where(eq(oauthTokens.id, row.id))
        .run()
      deviceId = generated
    }
    else {
      deviceId = row.deviceId
    }
  }
  else {
    // Fall back to user tokens (long-lived bot tokens)
    const userToken = await getAccountToken(token)
    if (!userToken) {
      return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown or expired access token', { soft_logout: false })
    }
    userId = userToken.userId
    deviceId = userToken.deviceId

    // Write-through cache; DB sync is batched by token cache service every 2 hours.
    await markAccountTokenUsed(token)
  }

  const trustResult = getTrustState(userId, deviceId)
  trustState = trustResult.trustState

  // Check account exists and is active
  if (isDeactivated(userId)) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  // Ensure device exists — needed for to-device delivery, keys/query, sync
  const trustReason = trustState === 'trusted'
    ? ((trustResult.existingDevice) ? 'legacy_backfill' : 'first_device')
    : 'new_login_unverified'
  ensureDevice(userId, deviceId, trustState, trustReason, c.req.header('x-forwarded-for') || null)

  c.set('auth', { userId, deviceId, isGuest: false, trustState } as AuthContext)

  if (trustState !== 'trusted') {
    if (!isPathAllowedForUnverifiedDevice(c.req.path, c.req.method))
      return matrixError(c, 'M_FORBIDDEN', 'Device is not verified', { errcode_detail: 'M_DEVICE_UNVERIFIED' })
  }

  await next()
}
