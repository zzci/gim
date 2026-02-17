import type { AuthEnv } from '@/shared/middleware/auth'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountTokens, devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixNotFound } from '@/shared/middleware/errors'

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
