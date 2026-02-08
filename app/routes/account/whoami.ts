import { Hono } from 'hono'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const whoamiRoute = new Hono()

whoamiRoute.use('/*', authMiddleware)

whoamiRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  return c.json({
    user_id: auth.userId,
    device_id: auth.deviceId,
    is_guest: auth.isGuest,
  })
})
