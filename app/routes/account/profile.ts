import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { userProfiles } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixError, matrixNotFound, matrixForbidden } from '@/middleware/errors'

export const profileRoute = new Hono()

// GET /profile/:userId - get full profile
profileRoute.get('/:userId', async (c) => {
  const userId = c.req.param('userId')
  const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)

  if (!profile[0]) {
    return matrixNotFound(c, 'User not found')
  }

  return c.json({
    displayname: profile[0].displayname ?? undefined,
    avatar_url: profile[0].avatarUrl ?? undefined,
  })
})

// GET /profile/:userId/displayname
profileRoute.get('/:userId/displayname', async (c) => {
  const userId = c.req.param('userId')
  const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)

  if (!profile[0]) {
    return matrixNotFound(c, 'User not found')
  }

  return c.json({
    displayname: profile[0].displayname ?? undefined,
  })
})

// PUT /profile/:userId/displayname
profileRoute.put('/:userId/displayname', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const userId = c.req.param('userId')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set displayname for other users')
  }

  const body = await c.req.json()
  await db.update(userProfiles)
    .set({ displayname: body.displayname ?? null })
    .where(eq(userProfiles.userId, userId))

  return c.json({})
})

// GET /profile/:userId/avatar_url
profileRoute.get('/:userId/avatar_url', async (c) => {
  const userId = c.req.param('userId')
  const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)

  if (!profile[0]) {
    return matrixNotFound(c, 'User not found')
  }

  return c.json({
    avatar_url: profile[0].avatarUrl ?? undefined,
  })
})

// PUT /profile/:userId/avatar_url
profileRoute.put('/:userId/avatar_url', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const userId = c.req.param('userId')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set avatar_url for other users')
  }

  const body = await c.req.json()
  await db.update(userProfiles)
    .set({ avatarUrl: body.avatar_url ?? null })
    .where(eq(userProfiles.userId, userId))

  return c.json({})
})
