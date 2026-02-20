import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accounts } from '@/db/schema'
import { invalidateDisplayNameCache } from '@/models/account'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'
import { avatarUrl as avatarUrlSchema, displayName as displayNameSchema, validate } from '@/shared/validation'

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

  invalidateDisplayNameCache(userId)

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
