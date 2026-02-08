import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { oneTimeKeys, fallbackKeys } from '@/db/schema'
import { authMiddleware } from '@/middleware/auth'

export const keysClaimRoute = new Hono()

keysClaimRoute.use('/*', authMiddleware)

keysClaimRoute.post('/', async (c) => {
  const body = await c.req.json()
  const requested = body.one_time_keys || {}

  const result: Record<string, Record<string, any>> = {}

  for (const [userId, deviceMap] of Object.entries(requested) as [string, Record<string, string>][]) {
    result[userId] = {}

    for (const [deviceId, algorithm] of Object.entries(deviceMap)) {
      // Try to claim a one-time key
      const otk = db.select().from(oneTimeKeys)
        .where(and(
          eq(oneTimeKeys.userId, userId),
          eq(oneTimeKeys.deviceId, deviceId),
          eq(oneTimeKeys.algorithm, algorithm),
          eq(oneTimeKeys.claimed, false),
        ))
        .limit(1)
        .get()

      if (otk) {
        // Mark as claimed
        db.update(oneTimeKeys)
          .set({ claimed: true })
          .where(eq(oneTimeKeys.id, otk.id))
          .run()

        result[userId]![deviceId] = {
          [`${otk.algorithm}:${otk.keyId}`]: otk.keyJson,
        }
      }
      else {
        // Fall back to fallback key
        const fbk = db.select().from(fallbackKeys)
          .where(and(
            eq(fallbackKeys.userId, userId),
            eq(fallbackKeys.deviceId, deviceId),
            eq(fallbackKeys.algorithm, algorithm),
          ))
          .limit(1)
          .get()

        if (fbk) {
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
