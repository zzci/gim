import type { Context, Next } from 'hono'
import type { AppServiceResolvedToken } from '@/models/auth'
import type { DeviceTrustState } from '@/shared/middleware/deviceTrust'
import { eq } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { oauthTokens } from '@/db/schema'
import { isDeactivated } from '@/models/account'
import { resolveToken } from '@/models/auth'
import { ensureDevice, getTrustState, invalidateTrustCache } from '@/models/device'
import { markAccountTokenUsed } from '@/modules/account/tokenCache'
import { ensureAppServiceUser } from '@/modules/appservice/config'
import { isPathAllowedForUnverifiedDevice } from '@/shared/middleware/deviceTrust'
import { generateDeviceId } from '@/utils/tokens'
import { matrixError } from './errors'

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

  const result = await resolveToken(token, serverName, c.req.query('user_id'))

  if (!result) {
    return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown or expired access token', { soft_logout: false })
  }

  // Error result from resolveToken
  if ('error' in result) {
    return matrixError(c, result.errorCode, result.error, result.extra)
  }

  // AppService tokens skip device tracking
  if (result.source === 'appservice') {
    const asResult = result as AppServiceResolvedToken
    ensureAppServiceUser(asResult.userId)
    c.set('auth', { userId: asResult.userId, deviceId: 'APPSERVICE', isGuest: false, trustState: 'trusted' } as AuthContext)
    await next()
    return
  }

  let { userId, deviceId } = result

  // Backfill legacy OAuth tokens that were issued without device_id
  if (result.source === 'oauth' && result.deviceIdBackfilled) {
    logger.warn('oauth_token_missing_device_id', { tokenId: result.oauthTokenId, userId })
    const generated = generateDeviceId()
    db.update(oauthTokens)
      .set({ deviceId: generated })
      .where(eq(oauthTokens.id, result.oauthTokenId!))
      .run()
    deviceId = generated
    await invalidateTrustCache(userId, generated)
  }

  // Mark account token as used (write-through cache; DB sync is batched)
  if (result.source === 'account') {
    await markAccountTokenUsed(token)
  }

  const trustResult = await getTrustState(userId, deviceId)
  const trustState = trustResult.trustState

  // Check account exists and is active
  if (await isDeactivated(userId)) {
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
