import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, devices, oauthTokens } from '@/db/schema'
import { issueTokensViaPkce } from '@/oauth/tokens'
import { matrixError } from '@/shared/middleware/errors'
import { generateDeviceId } from '@/utils/tokens'

export const loginRoute = new Hono()

loginRoute.get('/', (c) => {
  return c.json({
    flows: [
      {
        'type': 'm.login.sso',
        'oauth_aware_preferred': true,
        'org.matrix.msc3824.delegated_oidc_compatibility': true,
      },
      { type: 'm.login.token' },
    ],
  })
})

loginRoute.post('/', async (c) => {
  const body = await c.req.json()
  const { type, device_id, initial_device_display_name } = body

  if (type !== 'm.login.token') {
    return matrixError(c, 'M_UNKNOWN', `Unsupported login type: ${type}`)
  }

  const { token } = body
  if (!token) {
    return matrixError(c, 'M_BAD_JSON', 'Missing token')
  }

  const row = db.select().from(oauthTokens).where(eq(oauthTokens.id, `LoginToken:${token}`)).get()
  if (!row) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid login token')
  }

  if (row.consumedAt) {
    return matrixError(c, 'M_FORBIDDEN', 'Login token already used')
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return matrixError(c, 'M_FORBIDDEN', 'Login token expired')
  }

  db.update(oauthTokens).set({ consumedAt: new Date() }).where(eq(oauthTokens.id, `LoginToken:${token}`)).run()

  const accountId = row.accountId
  if (!accountId) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid login token')
  }

  const userId = `@${accountId}:${serverName}`

  const account = await db.select().from(accounts).where(eq(accounts.id, userId)).limit(1)
  if (!account[0]) {
    return matrixError(c, 'M_FORBIDDEN', 'User not found')
  }

  if (account[0].isDeactivated) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  // Validate client-provided device_id: non-empty, max 255 chars, no control chars
  // eslint-disable-next-line no-control-regex
  const isValidDeviceId = (id: string) => id && id.length <= 255 && !/[\x00-\x1F\x7F]/.test(id)

  let deviceId = device_id && isValidDeviceId(device_id) ? device_id : null
  if (!deviceId) {
    // Generate a unique device ID for this user with collision retry
    for (let attempt = 0; attempt < 5; attempt++) {
      deviceId = generateDeviceId()
      const existing = db.select({ id: devices.id }).from(devices).where(and(eq(devices.userId, userId), eq(devices.id, deviceId))).get()
      if (!existing)
        break
    }
  }
  const localpart = userId.split(':')[0]!.slice(1)
  const defaultTrustState = 'unverified'
  const defaultTrustReason = 'new_login_unverified'

  await db.insert(devices).values({
    userId,
    id: deviceId,
    displayName: initial_device_display_name || null,
    trustState: defaultTrustState,
    trustReason: defaultTrustReason,
    ipAddress: c.req.header('x-forwarded-for') || null,
  }).onConflictDoUpdate({
    target: [devices.userId, devices.id],
    set: {
      displayName: initial_device_display_name || undefined,
      lastSeenAt: new Date(),
      ipAddress: c.req.header('x-forwarded-for') || null,
    },
  })

  const tokens = await issueTokensViaPkce(localpart, deviceId)

  logger.info('login', { userId, deviceId, type: 'm.login.token' })

  return c.json({
    user_id: userId,
    access_token: tokens.access_token,
    device_id: deviceId,
    refresh_token: tokens.refresh_token,
    expires_in_ms: tokens.expires_in * 1000,
    well_known: {
      'm.homeserver': {
        base_url: `https://${serverName}`,
      },
    },
  })
})
