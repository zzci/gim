import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { getPresence } from '@/modules/presence/service'
import { authMiddleware } from '@/shared/middleware/auth'

export const presenceGetStatusRoute = new Hono<AuthEnv>()
presenceGetStatusRoute.use('/*', authMiddleware)

presenceGetStatusRoute.get('/:userId/status', (c) => {
  const userId = c.req.param('userId')
  const row = getPresence(userId)

  return c.json({
    presence: row?.state || 'offline',
    last_active_ago: row?.lastActiveAt ? Date.now() - row.lastActiveAt.getTime() : undefined,
    status_msg: row?.statusMsg || undefined,
    currently_active: row?.state === 'online',
  })
})
