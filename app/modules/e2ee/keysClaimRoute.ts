import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { e2eeFallbackKeys, e2eeOneTimeKeys } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

export const keysClaimRoute = new Hono<AuthEnv>()
keysClaimRoute.use('/*', authMiddleware)

keysClaimRoute.post('/', async (c) => {
  const body = await c.req.json()
  const requested = body.one_time_keys || {}

  const result: Record<string, Record<string, any>> = {}

  for (const [userId, deviceMap] of Object.entries(requested) as [string, Record<string, string>][]) {
    result[userId] = {}

    for (const [deviceId, algorithm] of Object.entries(deviceMap)) {
      const otk = db.select().from(e2eeOneTimeKeys).where(and(
        eq(e2eeOneTimeKeys.userId, userId),
        eq(e2eeOneTimeKeys.deviceId, deviceId),
        eq(e2eeOneTimeKeys.algorithm, algorithm),
        eq(e2eeOneTimeKeys.claimed, false),
      )).limit(1).get()

      if (otk) {
        db.update(e2eeOneTimeKeys)
          .set({ claimed: true })
          .where(eq(e2eeOneTimeKeys.id, otk.id))
          .run()

        result[userId]![deviceId] = {
          [`${otk.algorithm}:${otk.keyId}`]: otk.keyJson,
        }
      }
      else {
        const fbk = db.select().from(e2eeFallbackKeys).where(and(
          eq(e2eeFallbackKeys.userId, userId),
          eq(e2eeFallbackKeys.deviceId, deviceId),
          eq(e2eeFallbackKeys.algorithm, algorithm),
        )).limit(1).get()

        if (fbk) {
          if (!fbk.used) {
            db.update(e2eeFallbackKeys)
              .set({ used: true })
              .where(and(
                eq(e2eeFallbackKeys.userId, userId),
                eq(e2eeFallbackKeys.deviceId, deviceId),
                eq(e2eeFallbackKeys.algorithm, algorithm),
              ))
              .run()
          }

          result[userId]![deviceId] = {
            [`${fbk.algorithm}:${fbk.keyId}`]: fbk.keyJson,
          }
        }
      }
    }
  }

  return c.json({
    one_time_keys: result,
    failures: {},
  })
})
