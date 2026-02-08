import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { deviceKeys, oneTimeKeys, fallbackKeys } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const keysUploadRoute = new Hono()

keysUploadRoute.use('/*', authMiddleware)

keysUploadRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json()

  // Upload device keys
  if (body.device_keys) {
    const dk = body.device_keys
    await db.insert(deviceKeys).values({
      userId: auth.userId,
      deviceId: auth.deviceId,
      algorithms: dk.algorithms || [],
      keys: dk.keys || {},
      signatures: dk.signatures || {},
      displayName: dk.unsigned?.device_display_name || null,
    }).onConflictDoUpdate({
      target: [deviceKeys.userId, deviceKeys.deviceId],
      set: {
        algorithms: dk.algorithms || [],
        keys: dk.keys || {},
        signatures: dk.signatures || {},
        displayName: dk.unsigned?.device_display_name || null,
      },
    })
  }

  // Upload one-time keys
  if (body.one_time_keys) {
    for (const [keyIdFull, keyData] of Object.entries(body.one_time_keys)) {
      const colonIdx = keyIdFull.indexOf(':')
      const algorithm = keyIdFull.slice(0, colonIdx)
      const keyId = keyIdFull.slice(colonIdx + 1)

      await db.insert(oneTimeKeys).values({
        userId: auth.userId,
        deviceId: auth.deviceId,
        algorithm,
        keyId,
        keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
      })
    }
  }

  // Upload fallback keys
  if (body.fallback_keys || body['org.matrix.msc2732.fallback_keys']) {
    const fk = body.fallback_keys || body['org.matrix.msc2732.fallback_keys']
    for (const [keyIdFull, keyData] of Object.entries(fk)) {
      const colonIdx = keyIdFull.indexOf(':')
      const algorithm = keyIdFull.slice(0, colonIdx)
      const keyId = keyIdFull.slice(colonIdx + 1)

      await db.insert(fallbackKeys).values({
        userId: auth.userId,
        deviceId: auth.deviceId,
        algorithm,
        keyId,
        keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
      }).onConflictDoUpdate({
        target: [fallbackKeys.userId, fallbackKeys.deviceId, fallbackKeys.algorithm],
        set: {
          keyId,
          keyJson: typeof keyData === 'string' ? { key: keyData } : (keyData as Record<string, unknown>),
        },
      })
    }
  }

  // Count unclaimed one-time keys
  const counts: Record<string, number> = {}
  const otkRows = db.select({ algorithm: oneTimeKeys.algorithm })
    .from(oneTimeKeys)
    .where(and(
      eq(oneTimeKeys.userId, auth.userId),
      eq(oneTimeKeys.deviceId, auth.deviceId),
      eq(oneTimeKeys.claimed, false),
    ))
    .all()

  for (const row of otkRows) {
    counts[row.algorithm] = (counts[row.algorithm] || 0) + 1
  }

  return c.json({ one_time_key_counts: counts })
})
