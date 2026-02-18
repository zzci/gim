import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { devices } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { deviceUpdateBody, validate } from '@/shared/validation'

export const devicePutRoute = new Hono<AuthEnv>()
devicePutRoute.use('/*', authMiddleware)

devicePutRoute.put('/:deviceId', async (c) => {
  const auth = c.get('auth')
  const deviceId = c.req.param('deviceId')
  const body = await c.req.json()

  const v = validate(c, deviceUpdateBody, body)
  if (!v.success)
    return v.response

  await db.update(devices)
    .set({ displayName: v.data.display_name })
    .where(and(eq(devices.userId, auth.userId), eq(devices.id, deviceId)))
    .run()

  return c.json({})
})
