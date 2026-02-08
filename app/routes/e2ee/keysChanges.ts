import { Hono } from 'hono'
import { authMiddleware } from '@/middleware/auth'

export const keysChangesRoute = new Hono()

keysChangesRoute.use('/*', authMiddleware)

// GET /keys/changes?from=&to=
// Returns users whose device lists have changed between two sync tokens
keysChangesRoute.get('/', async (c) => {
  // Simplified: return empty changes
  // Full implementation would track device list changes per stream_order
  return c.json({
    changed: [],
    left: [],
  })
})
