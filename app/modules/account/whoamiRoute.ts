import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { authMiddleware } from '@/shared/middleware/auth'

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
