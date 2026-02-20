import type { Context, Next } from 'hono'
import type { DeviceTrustState } from '@/shared/middleware/deviceTrust'
import { and, eq } from 'drizzle-orm'
import { serverName } from '@/config'
import { db } from '@/db'
import { accountDataCrossSigning, accounts, accountTokens, devices, oauthTokens } from '@/db/schema'
import { ensureAppServiceUser, getRegistrationByAsToken, isUserInNamespace } from '@/modules/appservice/config'
import { isPathAllowedForUnverifiedDevice, normalizeDeviceTrustState } from '@/shared/middleware/deviceTrust'
import { generateDeviceId } from '@/utils/tokens'
import { matrixError } from './errors'

const deviceLastUpdated = new Map<string, number>()
const DEVICE_UPDATE_INTERVAL = 5 * 60 * 1000 // 5 minutes

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [key, ts] of deviceLastUpdated) {
    if (ts < cutoff)
      deviceLastUpdated.delete(key)
  }
}, 10 * 60 * 1000)

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
  const row = db.select().from(oauthTokens).where(
    and(
      eq(oauthTokens.id, `AccessToken:${token}`),
      eq(oauthTokens.type, 'AccessToken'),
    ),
  ).get()

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
    const userToken = db.select().from(accountTokens).where(eq(accountTokens.token, token)).get()
    if (!userToken) {
      return matrixError(c, 'M_UNKNOWN_TOKEN', 'Unknown or expired access token', { soft_logout: false })
    }
    userId = userToken.userId
    deviceId = userToken.deviceId

    // Update lastUsedAt
    db.update(accountTokens).set({ lastUsedAt: new Date() }).where(eq(accountTokens.token, token)).run()
  }

  const existingDevice = db.select({ trustState: devices.trustState })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.id, deviceId)))
    .get()
  if (existingDevice) {
    trustState = normalizeDeviceTrustState(existingDevice.trustState)
  }
  else {
    // New device — trust automatically only if user has no devices AND no cross-signing keys
    const anyDevice = db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId)).limit(1).get()
    const hasCrossSigningKeys = !anyDevice && !!db.select({ userId: accountDataCrossSigning.userId })
      .from(accountDataCrossSigning)
      .where(and(eq(accountDataCrossSigning.userId, userId), eq(accountDataCrossSigning.keyType, 'master')))
      .get()
    trustState = !anyDevice && !hasCrossSigningKeys ? 'trusted' : 'unverified'
  }

  // Check account exists and is active
  const account = db.select().from(accounts).where(eq(accounts.id, userId)).get()
  if (account?.isDeactivated) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  // Ensure device exists — needed for to-device delivery, keys/query, sync
  // Throttle writes to avoid excessive DB updates on every request
  const deviceKey = `${userId}:${deviceId}`
  const now = Date.now()
  const lastUpdated = deviceLastUpdated.get(deviceKey) || 0
  if (now - lastUpdated > DEVICE_UPDATE_INTERVAL) {
    db.insert(devices).values({
      userId,
      id: deviceId,
      trustState,
      trustReason: trustState === 'trusted' ? (existingDevice ? 'legacy_backfill' : 'first_device') : 'new_login_unverified',
      ipAddress: c.req.header('x-forwarded-for') || null,
      lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: [devices.userId, devices.id],
      set: {
        lastSeenAt: new Date(),
        ipAddress: c.req.header('x-forwarded-for') || null,
      },
    }).run()
    deviceLastUpdated.set(deviceKey, now)
  }

  c.set('auth', { userId, deviceId, isGuest: false, trustState } as AuthContext)

  if (trustState !== 'trusted') {
    if (!isPathAllowedForUnverifiedDevice(c.req.path, c.req.method))
      return matrixError(c, 'M_FORBIDDEN', 'Device is not verified', { errcode_detail: 'M_DEVICE_UNVERIFIED' })
  }

  await next()
}
