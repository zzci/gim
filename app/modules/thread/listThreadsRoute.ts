import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { z } from 'zod/v4'
import { getRoomMembership } from '@/modules/room/service'
import { getThreadRoots } from '@/modules/thread/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixForbidden } from '@/shared/middleware/errors'
import { validate } from '@/shared/validation'

const threadQuerySchema = z.object({
  include: z.enum(['all', 'participated']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  from: z.string().optional(),
})

export const threadListRoute = new Hono<AuthEnv>()
threadListRoute.use('/*', authMiddleware)

threadListRoute.get('/:roomId/threads', async (c) => {
  const auth = c.get('auth')
  const roomId = c.req.param('roomId')

  const membership = await getRoomMembership(roomId, auth.userId)
  if (membership !== 'join' && membership !== 'invite') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const rawQuery = {
    include: c.req.query('include') ?? 'all',
    limit: c.req.query('limit') ?? '50',
    from: c.req.query('from'),
  }

  const v = validate(c, threadQuerySchema, rawQuery)
  if (!v.success)
    return v.response

  const { include, limit, from } = v.data

  const result = getThreadRoots(roomId, auth.userId, include, limit, from)

  return c.json(result)
})
