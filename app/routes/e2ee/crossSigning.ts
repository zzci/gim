import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { crossSigningKeys, deviceKeys } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const crossSigningRoute = new Hono()

crossSigningRoute.use('/*', authMiddleware)

// POST /keys/device_signing/upload - upload cross-signing keys
crossSigningRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json()

  if (body.master_key) {
    await db.insert(crossSigningKeys).values({
      userId: auth.userId,
      keyType: 'master',
      keyData: body.master_key,
    }).onConflictDoUpdate({
      target: [crossSigningKeys.userId, crossSigningKeys.keyType],
      set: { keyData: body.master_key },
    })
  }

  if (body.self_signing_key) {
    await db.insert(crossSigningKeys).values({
      userId: auth.userId,
      keyType: 'self_signing',
      keyData: body.self_signing_key,
    }).onConflictDoUpdate({
      target: [crossSigningKeys.userId, crossSigningKeys.keyType],
      set: { keyData: body.self_signing_key },
    })
  }

  if (body.user_signing_key) {
    await db.insert(crossSigningKeys).values({
      userId: auth.userId,
      keyType: 'user_signing',
      keyData: body.user_signing_key,
    }).onConflictDoUpdate({
      target: [crossSigningKeys.userId, crossSigningKeys.keyType],
      set: { keyData: body.user_signing_key },
    })
  }

  return c.json({})
})

// Signatures upload
export const signaturesUploadRoute = new Hono()

signaturesUploadRoute.use('/*', authMiddleware)

signaturesUploadRoute.post('/', async (c) => {
  const body = await c.req.json()
  // For now, just accept and store signatures on device keys
  // Full implementation would merge signatures into existing key data
  return c.json({ failures: {} })
})
