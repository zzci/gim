import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { getPresence, setPresence } from '@/modules/presence/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden } from '@/shared/middleware/errors'

export const presenceRoute = new Hono<AuthEnv>()
presenceRoute.use('/*', authMiddleware)

// GET /:userId/status
presenceRoute.get('/:userId/status', (c) => {
  const userId = c.req.param('userId')
  const row = getPresence(userId)

  return c.json({
    presence: row?.state || 'offline',
    last_active_ago: row?.lastActiveAt ? Date.now() - row.lastActiveAt.getTime() : undefined,
    status_msg: row?.statusMsg || undefined,
    currently_active: row?.state === 'online',
  })
})

// PUT /:userId/status
presenceRoute.put('/:userId/status', async (c) => {
  const auth = c.get('auth')
  const userId = c.req.param('userId')

  if (auth.userId !== userId) {
    return matrixForbidden(c, 'Cannot set presence for another user')
  }

  const body = await c.req.json()
  const state = body.presence || 'online'
  const statusMsg = body.status_msg

  if (!['online', 'unavailable', 'offline'].includes(state)) {
    return c.json({ errcode: 'M_INVALID_PARAM', error: 'Invalid presence state' }, 400)
  }

  setPresence(userId, state, statusMsg)

  return c.json({})
})
