import type { AuthEnv } from '@/shared/middleware/auth'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountCrossSigningKeys, accountData, accountFilters, accounts, accountTokens, devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, oauthTokens, roomMembers } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
import { getDefaultPushRules } from '@/modules/notification/service'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { avatarUrl as avatarUrlSchema, displayName as displayNameSchema, validate } from '@/shared/validation'
import { generateUlid } from '@/utils/tokens'

// --- Whoami ---

export const whoamiRoute = new Hono<AuthEnv>()
whoamiRoute.use('/*', authMiddleware)

whoamiRoute.get('/', async (c) => {
  const auth = c.get('auth')
  return c.json({
    user_id: auth.userId,
    device_id: auth.deviceId,
    is_guest: auth.isGuest,
  })
})

// --- Profile ---

export const profileRoute = new Hono<AuthEnv>()

profileRoute.get('/:userId', async (c) => {
  const userId = c.req.param('userId')
  const account = await db.select().from(accounts).where(eq(accounts.id, userId)).limit(1)

  if (!account[0]) {
    return matrixNotFound(c, 'User not found')
  }

  return c.json({
    displayname: account[0].displayname ?? undefined,
    avatar_url: account[0].avatarUrl ?? undefined,
  })
})

profileRoute.get('/:userId/displayname', async (c) => {
  const userId = c.req.param('userId')
  const account = await db.select().from(accounts).where(eq(accounts.id, userId)).limit(1)

  if (!account[0]) {
    return matrixNotFound(c, 'User not found')
  }

  return c.json({
    displayname: account[0].displayname ?? undefined,
  })
})

profileRoute.put('/:userId/displayname', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const userId = c.req.param('userId')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set displayname for other users')
  }

  const body = await c.req.json()

  if (body.displayname != null) {
    const v = validate(c, displayNameSchema, body.displayname)
    if (!v.success)
      return v.response
  }

  await db.update(accounts)
    .set({ displayname: body.displayname ?? null })
    .where(eq(accounts.id, userId))

  return c.json({})
})

profileRoute.get('/:userId/avatar_url', async (c) => {
  const userId = c.req.param('userId')
  const account = await db.select().from(accounts).where(eq(accounts.id, userId)).limit(1)

  if (!account[0]) {
    return matrixNotFound(c, 'User not found')
  }

  return c.json({
    avatar_url: account[0].avatarUrl ?? undefined,
  })
})

profileRoute.put('/:userId/avatar_url', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const userId = c.req.param('userId')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set avatar_url for other users')
  }

  const body = await c.req.json()

  if (body.avatar_url != null) {
    const v = validate(c, avatarUrlSchema, body.avatar_url)
    if (!v.success)
      return v.response
  }

  await db.update(accounts)
    .set({ avatarUrl: body.avatar_url ?? null })
    .where(eq(accounts.id, userId))

  return c.json({})
})

// --- Account Data ---

export const accountDataRoute = new Hono<AuthEnv>()
accountDataRoute.use('/*', authMiddleware)

accountDataRoute.put('/:type', async (c) => {
  const auth = c.get('auth')
  const userId = c.req.url.includes('/user/') ? c.req.param('userId') || auth.userId : auth.userId
  const type = c.req.param('type')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set account data for other users')
  }

  const content = await c.req.json()

  const streamId = generateUlid()

  await db.insert(accountData).values({
    userId,
    type,
    roomId: '',
    content,
    streamId,
  }).onConflictDoUpdate({
    target: [accountData.userId, accountData.type, accountData.roomId],
    set: { content, streamId },
  })

  notifyUser(userId)

  return c.json({})
})

accountDataRoute.get('/:type', async (c) => {
  const auth = c.get('auth')
  const userId = auth.userId
  const type = c.req.param('type')

  const result = await db.select()
    .from(accountData)
    .where(and(
      eq(accountData.userId, userId),
      eq(accountData.type, type),
      eq(accountData.roomId, ''),
    ))
    .limit(1)

  if (!result[0]) {
    return matrixNotFound(c, 'Account data not found')
  }

  return c.json(result[0].content)
})

// --- User Filter ---

export const userFilterRoute = new Hono<AuthEnv>()
userFilterRoute.use('/*', authMiddleware)

userFilterRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const json = JSON.stringify(body)

  // Reuse existing filter if identical JSON already exists for this user
  const existing = db.select({ id: accountFilters.id, filterJson: accountFilters.filterJson })
    .from(accountFilters)
    .where(eq(accountFilters.userId, auth.userId))
    .all()
    .find(r => JSON.stringify(r.filterJson) === json)

  if (existing) {
    return c.json({ filter_id: existing.id })
  }

  const row = db.insert(accountFilters).values({
    userId: auth.userId,
    filterJson: body,
  }).returning({ id: accountFilters.id }).get()

  return c.json({ filter_id: row.id })
})

userFilterRoute.get('/:filterId', async (c) => {
  const auth = c.get('auth')
  const filterId = c.req.param('filterId')

  const result = await db.select()
    .from(accountFilters)
    .where(eq(accountFilters.id, filterId))
    .limit(1)

  if (!result[0] || result[0].userId !== auth.userId) {
    return matrixNotFound(c, 'Filter not found')
  }

  return c.json(result[0].filterJson)
})

// --- Push Rules ---

export const pushRulesRoute = new Hono<AuthEnv>()
pushRulesRoute.use('/*', authMiddleware)

pushRulesRoute.get('/', async (c) => {
  const auth = c.get('auth')
  return c.json(getDefaultPushRules(auth.userId))
})

pushRulesRoute.get('/*', async (c) => {
  return c.json({})
})

pushRulesRoute.put('/*', async (c) => {
  return c.json({})
})

pushRulesRoute.delete('/*', async (c) => {
  return c.json({})
})

// --- User Tokens ---

export const accountTokensRoute = new Hono<AuthEnv>()
accountTokensRoute.use('/*', authMiddleware)

function maskToken(token: string): string {
  if (token.length <= 6)
    return '***'
  return `${token.slice(0, 3)}...${token.slice(-3)}`
}

accountTokensRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json<{ name?: string, device_id?: string }>()

  const name = body.name
  if (!name) {
    return c.json({ errcode: 'M_BAD_JSON', error: 'Missing required field: name' }, 400)
  }

  const token = randomBytes(32).toString('hex')
  const deviceId = body.device_id || `BOT_${randomBytes(4).toString('hex').toUpperCase()}`

  db.insert(devices).values({
    userId: auth.userId,
    id: deviceId,
    displayName: name,
    createdAt: new Date(),
  }).onConflictDoNothing().run()

  db.insert(accountTokens).values({
    token,
    userId: auth.userId,
    deviceId,
    name,
  }).run()

  return c.json({
    token,
    user_id: auth.userId,
    device_id: deviceId,
    name,
    created_at: Date.now(),
  }, 201)
})

accountTokensRoute.get('/', async (c) => {
  const auth = c.get('auth')

  const rows = db.select()
    .from(accountTokens)
    .where(eq(accountTokens.userId, auth.userId))
    .all()

  return c.json({
    tokens: rows.map(r => ({
      token: maskToken(r.token),
      device_id: r.deviceId,
      name: r.name,
      created_at: r.createdAt ? Number(r.createdAt) : null,
      last_used_at: r.lastUsedAt ? Number(r.lastUsedAt) : null,
    })),
  })
})

accountTokensRoute.delete('/:token', async (c) => {
  const auth = c.get('auth')
  const token = c.req.param('token')

  const row = db.select()
    .from(accountTokens)
    .where(and(eq(accountTokens.token, token), eq(accountTokens.userId, auth.userId)))
    .get()

  if (!row)
    return matrixNotFound(c, 'Token not found')

  const { deviceId } = row

  db.delete(accountTokens).where(eq(accountTokens.token, token)).run()

  db.delete(e2eeDeviceKeys).where(and(
    eq(e2eeDeviceKeys.userId, auth.userId),
    eq(e2eeDeviceKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeOneTimeKeys).where(and(
    eq(e2eeOneTimeKeys.userId, auth.userId),
    eq(e2eeOneTimeKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeFallbackKeys).where(and(
    eq(e2eeFallbackKeys.userId, auth.userId),
    eq(e2eeFallbackKeys.deviceId, deviceId),
  )).run()

  db.delete(e2eeToDeviceMessages).where(and(
    eq(e2eeToDeviceMessages.userId, auth.userId),
    eq(e2eeToDeviceMessages.deviceId, deviceId),
  )).run()

  db.delete(devices).where(and(
    eq(devices.userId, auth.userId),
    eq(devices.id, deviceId),
  )).run()

  return c.json({})
})

// --- Account Deactivation ---

export const deactivateRoute = new Hono<AuthEnv>()
deactivateRoute.use('/*', authMiddleware)

deactivateRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const userId = auth.userId

  // Wrap direct DB operations in a transaction
  const joinedRooms = db.transaction((tx) => {
    // Mark user as deactivated
    tx.update(accounts).set({ isDeactivated: true }).where(eq(accounts.id, userId)).run()

    // Revoke all OAuth tokens
    const localpart = userId.split(':')[0]?.slice(1) || ''
    tx.delete(oauthTokens).where(eq(oauthTokens.accountId, localpart)).run()

    // Delete all user tokens
    tx.delete(accountTokens).where(eq(accountTokens.userId, userId)).run()

    // Get joined rooms before cleanup
    const rooms = tx.select({ roomId: roomMembers.roomId })
      .from(roomMembers)
      .where(and(
        eq(roomMembers.userId, userId),
        eq(roomMembers.membership, 'join'),
      ))
      .all()

    // Clean up E2EE keys
    tx.delete(e2eeDeviceKeys).where(eq(e2eeDeviceKeys.userId, userId)).run()
    tx.delete(e2eeOneTimeKeys).where(eq(e2eeOneTimeKeys.userId, userId)).run()
    tx.delete(e2eeFallbackKeys).where(eq(e2eeFallbackKeys.userId, userId)).run()
    tx.delete(accountCrossSigningKeys).where(eq(accountCrossSigningKeys.userId, userId)).run()

    // Delete all devices
    tx.delete(devices).where(eq(devices.userId, userId)).run()

    return rooms
  })

  // Leave all joined rooms outside transaction (createEvent has its own transactions)
  for (const { roomId } of joinedRooms) {
    createEvent({
      roomId,
      sender: userId,
      type: 'm.room.member',
      stateKey: userId,
      content: { membership: 'leave' },
    })
  }

  return c.json({ id_server_unbind_result: 'no-support' })
})
