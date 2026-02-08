import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, devices, accessTokens, userProfiles } from '@/db/schema'
import { serverName } from '@/config'
import { generateAccessToken, generateDeviceId, generateRefreshToken } from '@/utils/tokens'
import { matrixError } from '@/middleware/errors'

export const loginRoute = new Hono()

// GET /login - return supported login flows
loginRoute.get('/', async (c) => {
  return c.json({
    flows: [
      { type: 'm.login.password' },
    ],
  })
})

// POST /login - authenticate user
loginRoute.post('/', async (c) => {
  const body = await c.req.json()
  const { type, identifier, password, device_id, initial_device_display_name } = body

  if (type !== 'm.login.password') {
    return matrixError(c, 'M_UNKNOWN', `Unsupported login type: ${type}`)
  }

  if (!password) {
    return matrixError(c, 'M_BAD_JSON', 'Missing password')
  }

  // Resolve user ID from identifier or legacy 'user' field
  let userId: string
  if (identifier) {
    if (identifier.type === 'm.id.user') {
      const user = identifier.user as string
      userId = user.startsWith('@') ? user : `@${user}:${serverName}`
    }
    else if (identifier.type === 'm.id.thirdparty') {
      return matrixError(c, 'M_UNKNOWN', 'Third-party login not supported')
    }
    else {
      return matrixError(c, 'M_UNKNOWN', `Unsupported identifier type: ${identifier.type}`)
    }
  }
  else if (body.user) {
    // Legacy format: { "user": "username", "password": "..." }
    const user = body.user as string
    userId = user.startsWith('@') ? user : `@${user}:${serverName}`
  }
  else {
    return matrixError(c, 'M_BAD_JSON', 'Missing identifier or user')
  }

  // Lookup user
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user[0]) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid username or password')
  }

  if (user[0].isDeactivated) {
    return matrixError(c, 'M_USER_DEACTIVATED', 'This account has been deactivated')
  }

  if (!user[0].passwordHash) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid username or password')
  }

  // Verify password
  const valid = await Bun.password.verify(password, user[0].passwordHash)
  if (!valid) {
    return matrixError(c, 'M_FORBIDDEN', 'Invalid username or password')
  }

  // Create device
  const deviceId = device_id || generateDeviceId()
  const token = generateAccessToken()
  const refreshToken = generateRefreshToken()

  // Upsert device
  await db.insert(devices).values({
    userId,
    id: deviceId,
    displayName: initial_device_display_name || null,
    ipAddress: c.req.header('x-forwarded-for') || null,
  }).onConflictDoUpdate({
    target: [devices.userId, devices.id],
    set: {
      displayName: initial_device_display_name || undefined,
      lastSeenAt: new Date(),
      ipAddress: c.req.header('x-forwarded-for') || null,
    },
  })

  // If reusing device_id, invalidate old tokens for that device
  if (device_id) {
    await db.delete(accessTokens).where(
      eq(accessTokens.deviceId, deviceId),
    )
  }

  // Create access token
  await db.insert(accessTokens).values({
    token,
    userId,
    deviceId,
    refreshToken,
  })

  return c.json({
    user_id: userId,
    access_token: token,
    device_id: deviceId,
    refresh_token: refreshToken,
    well_known: {
      'm.homeserver': {
        base_url: `https://${serverName}`,
      },
    },
  })
})
