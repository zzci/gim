import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { authMiddleware } from '@/shared/middleware/auth'

// ---- Preview URL ----
export const mediaPreviewRoute = new Hono<AuthEnv>()
mediaPreviewRoute.use('/*', authMiddleware)

mediaPreviewRoute.get('/', (c) => {
  // URL preview - stub returning empty
  return c.json({})
})
