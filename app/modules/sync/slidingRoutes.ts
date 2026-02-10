import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { z } from 'zod/v4'
import { waitForNotification } from '@/modules/sync/notifier'
import { buildSlidingSyncResponse, hasSlidingSyncChanges } from '@/modules/sync/slidingService'
import { decSyncConnections, incSyncConnections } from '@/shared/metrics'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'

const slidingSyncSchema = z.object({
  lists: z.record(z.string(), z.object({
    ranges: z.array(z.tuple([z.number(), z.number()])),
    required_state: z.array(z.tuple([z.string(), z.string()])).optional(),
    timeline_limit: z.number().min(0).max(100).optional(),
    filters: z.object({
      is_dm: z.boolean().optional(),
      room_types: z.array(z.string()).optional(),
    }).optional(),
  })).optional(),
  room_subscriptions: z.record(z.string(), z.object({
    required_state: z.array(z.tuple([z.string(), z.string()])).optional(),
    timeline_limit: z.number().min(0).max(100).optional(),
  })).optional(),
  extensions: z.object({
    to_device: z.object({
      enabled: z.boolean().optional(),
      since: z.string().optional(),
    }).optional(),
    e2ee: z.object({
      enabled: z.boolean().optional(),
    }).optional(),
    account_data: z.object({
      enabled: z.boolean().optional(),
    }).optional(),
  }).optional(),
})

export const slidingSyncRoute = new Hono<AuthEnv>()

slidingSyncRoute.use('/*', authMiddleware)

slidingSyncRoute.post('/sync', async (c) => {
  const auth = c.get('auth')
  try {
    const timeout = Math.min(Number.parseInt(c.req.query('timeout') || '0'), 30000)
    const pos = c.req.query('pos') || undefined

    let body: unknown
    try {
      body = await c.req.json()
    }
    catch {
      body = {}
    }

    const parsed = slidingSyncSchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || 'Invalid request body'
      return matrixError(c, 'M_BAD_JSON', message)
    }

    const requestBody = parsed.data

    // Build initial response
    let response = buildSlidingSyncResponse(
      auth.userId,
      auth.deviceId,
      requestBody,
      pos,
    )

    // Long-poll: if incremental sync has no changes and timeout > 0, wait
    if (pos && timeout > 0 && !hasSlidingSyncChanges(response)) {
      incSyncConnections()
      try {
        const notified = await waitForNotification(auth.userId, timeout)
        if (notified) {
          response = buildSlidingSyncResponse(
            auth.userId,
            auth.deviceId,
            requestBody,
            pos,
          )
        }
      }
      finally {
        decSyncConnections()
      }
    }

    c.header('Connection', 'close')
    return c.json(response)
  }
  catch (err) {
    logger.error('sliding_sync_failed', {
      userId: auth.userId,
      deviceId: auth.deviceId,
      error: err instanceof Error ? err.message : err,
    })
    return c.json({ errcode: 'M_UNKNOWN', error: 'Internal sliding sync error' }, 500)
  }
})
