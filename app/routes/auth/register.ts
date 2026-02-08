import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, devices, accessTokens, userProfiles } from '@/db/schema'
import { serverName } from '@/config'
import { generateAccessToken, generateDeviceId, generateRefreshToken } from '@/utils/tokens'
import { matrixError } from '@/middleware/errors'

export const registerRoute = new Hono()

// POST /register - register a new user
registerRoute.post('/', async (c) => {
  const body = await c.req.json()
  const {
    username,
    password,
    device_id,
    initial_device_display_name,
    inhibit_login,
    auth: authData,
  } = body

  const kind = c.req.query('kind') || 'user'

  // Validate username
  if (!username && kind !== 'guest') {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing username')
  }

  // Validate username format
  if (username && !/^[a-z0-9._=\-/]+$/i.test(username)) {
    return matrixError(c, 'M_INVALID_USERNAME', 'User ID can only contain characters a-z, 0-9, ., _, =, -, and /')
  }

  // Check for UIA (User-Interactive Authentication)
  if (!authData) {
    // Return UIA response: password registration requires m.login.dummy stage
    // Clients should provide password in the top-level body field
    return c.json({
      flows: [
        { stages: ['m.login.dummy'] },
      ],
      params: {},
      session: crypto.randomUUID(),
    }, 401)
  }

  // Validate UIA stage
  if (authData.type !== 'm.login.dummy') {
    return matrixError(c, 'M_UNKNOWN', `Unsupported auth type: ${authData.type}`)
  }

  // For regular users, password is required
  if (kind !== 'guest' && !password) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing password')
  }

  const userId = kind === 'guest'
    ? `@_guest_${crypto.randomUUID().slice(0, 8)}:${serverName}`
    : `@${username}:${serverName}`

  // Check if user already exists
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (existing[0]) {
    return matrixError(c, 'M_USER_IN_USE', 'User ID already taken')
  }

  // Hash password
  const passwordHash = password ? await Bun.password.hash(password) : null

  // Create user
  await db.insert(users).values({
    id: userId,
    passwordHash,
    isGuest: kind === 'guest',
  })

  // Create user profile
  await db.insert(userProfiles).values({
    userId,
  })

  if (inhibit_login) {
    return c.json({
      user_id: userId,
    })
  }

  // Create device and access token
  const deviceId = device_id || generateDeviceId()
  const token = generateAccessToken()
  const refreshToken = generateRefreshToken()

  await db.insert(devices).values({
    userId,
    id: deviceId,
    displayName: initial_device_display_name || null,
    ipAddress: c.req.header('x-forwarded-for') || null,
  })

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
  })
})
