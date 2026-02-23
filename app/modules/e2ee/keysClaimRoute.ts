import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, sqlite } from '@/db'
import { e2eeFallbackKeys } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

const claimOtkStmt = sqlite.prepare(`
  UPDATE e2ee_one_time_keys
  SET claimed = 1
  WHERE id = (
    SELECT id FROM e2ee_one_time_keys
    WHERE user_id = ? AND device_id = ? AND algorithm = ? AND claimed = 0
    LIMIT 1
  )
  RETURNING *
`)

export const keysClaimRoute = new Hono<AuthEnv>()
keysClaimRoute.use('/*', authMiddleware)

keysClaimRoute.post('/', async (c) => {
  const body = await c.req.json()
  const requested = body.one_time_keys || {}

  const result: Record<string, Record<string, any>> = {}

  for (const [userId, deviceMap] of Object.entries(requested) as [
    string,
    Record<string, string>,
  ][]) {
    result[userId] = {}

    for (const [deviceId, algorithm] of Object.entries(deviceMap)) {
      const otk = claimOtkStmt.get(userId, deviceId, algorithm) as any

      if (otk) {
        result[userId]![deviceId] = {
          [`${otk.algorithm}:${otk.key_id}`]: JSON.parse(otk.key_json),
        }
      }
      else {
        const fbk = db.transaction((tx) => {
          const row = tx
            .select()
            .from(e2eeFallbackKeys)
            .where(
              and(
                eq(e2eeFallbackKeys.userId, userId),
                eq(e2eeFallbackKeys.deviceId, deviceId),
                eq(e2eeFallbackKeys.algorithm, algorithm),
              ),
            )
            .limit(1)
            .get()

          if (row && !row.used) {
            tx.update(e2eeFallbackKeys)
              .set({ used: true })
              .where(
                and(
                  eq(e2eeFallbackKeys.userId, userId),
                  eq(e2eeFallbackKeys.deviceId, deviceId),
                  eq(e2eeFallbackKeys.algorithm, algorithm),
                ),
              )
              .run()
          }

          return row
        })

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
