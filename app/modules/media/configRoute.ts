import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { MAX_UPLOAD_SIZE } from '@/modules/media/mediaHelpers'
import { authMiddleware } from '@/shared/middleware/auth'

// ---- Config ----
export const mediaConfigRoute = new Hono<AuthEnv>()

// GET /_matrix/client/v1/media/config
mediaConfigRoute.use('/*', authMiddleware)
mediaConfigRoute.get('/', (c) => {
  return c.json({
    'm.upload.size': MAX_UPLOAD_SIZE,
  })
})
