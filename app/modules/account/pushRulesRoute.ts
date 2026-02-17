import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { getDefaultPushRules } from '@/modules/notification/service'
import { authMiddleware } from '@/shared/middleware/auth'

export const pushRulesRoute = new Hono<AuthEnv>()
pushRulesRoute.use('/*', authMiddleware)

pushRulesRoute.get('/', async (c) => {
  const auth = c.get('auth')
  return c.json(getDefaultPushRules(auth.userId))
})

pushRulesRoute.get('/*', async (c) => c.json({}))
pushRulesRoute.put('/*', async (c) => c.json({}))
pushRulesRoute.delete('/*', async (c) => c.json({}))
