import type { CrossSigningDbType } from './crossSigningHelpers'
import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountData, e2eeDeviceListChanges } from '@/db/schema'
import { notifyUser } from '@/modules/sync/notifier'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'
import { generateUlid } from '@/utils/tokens'
import { accountDataTypeToCrossSigningType, CROSS_SIGNING_ACCOUNT_DATA_TYPE, CROSS_SIGNING_ACCOUNT_DATA_TYPES, isCrossSigningResetVerified, stableJson } from './crossSigningHelpers'

const requiredResetTypes: CrossSigningDbType[] = ['master', 'self_signing', 'user_signing']

export const crossSigningRoute = new Hono<AuthEnv>()
crossSigningRoute.use('/*', authMiddleware)

crossSigningRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()

  const keyTypes = [
    { field: 'master_key', usage: 'master', dbType: 'master' as const },
    { field: 'self_signing_key', usage: 'self_signing', dbType: 'self_signing' as const },
    { field: 'user_signing_key', usage: 'user_signing', dbType: 'user_signing' as const },
  ]

  const incoming: Array<{ dbType: CrossSigningDbType, keyData: Record<string, unknown> }> = []

  for (const { field, usage, dbType } of keyTypes) {
    const keyData = body[field]
    if (!keyData)
      continue

    if (!keyData.keys || typeof keyData.keys !== 'object') {
      return matrixError(c, 'M_INVALID_PARAM', `Missing or invalid "keys" in ${field}`)
    }

    if (!keyData.signatures || typeof keyData.signatures !== 'object' || Object.keys(keyData.signatures).length === 0) {
      return matrixError(c, 'M_INVALID_PARAM', `Missing or empty "signatures" in ${field}`)
    }

    if (!Array.isArray(keyData.usage) || !keyData.usage.includes(usage)) {
      return matrixError(c, 'M_INVALID_PARAM', `Invalid "usage" in ${field}, expected ["${usage}"]`)
    }

    const ed25519Keys = Object.keys(keyData.keys).filter(k => k.startsWith('ed25519:'))
    if (ed25519Keys.length !== 1) {
      return matrixError(c, 'M_INVALID_PARAM', `Expected exactly one ed25519 key in ${field}, found ${ed25519Keys.length}`)
    }

    if (keyData.user_id && keyData.user_id !== auth.userId) {
      return matrixError(c, 'M_INVALID_PARAM', `user_id in ${field} does not match authenticated user`)
    }

    incoming.push({
      dbType,
      keyData: keyData as Record<string, unknown>,
    })
  }

  if (incoming.length === 0) {
    return c.json({})
  }

  const existingRows = db.select({
    type: accountData.type,
    content: accountData.content,
  }).from(accountData).where(and(
    eq(accountData.userId, auth.userId),
    eq(accountData.roomId, ''),
    inArray(accountData.type, CROSS_SIGNING_ACCOUNT_DATA_TYPES),
  )).all()

  const existingByType = new Map<CrossSigningDbType, Record<string, unknown>>()
  for (const row of existingRows) {
    const keyType = accountDataTypeToCrossSigningType(row.type)
    if (keyType)
      existingByType.set(keyType, row.content as Record<string, unknown>)
  }
  const incomingByType = new Map(incoming.map(r => [r.dbType, r.keyData]))

  const noDiff = requiredResetTypes.every((t) => {
    const prev = existingByType.get(t)
    const next = incomingByType.get(t)
    if (!prev && !next)
      return true
    if (!prev || !next)
      return false
    return stableJson(prev) === stableJson(next)
  })

  if (existingRows.length > 0) {
    if (noDiff) {
      return c.json({})
    }

    if (body.reset !== true) {
      return matrixError(c, 'M_FORBIDDEN', 'Cross-signing metadata already exists; reset=true is required')
    }

    if (!isCrossSigningResetVerified(c.req.header('Authorization'), auth.userId, body.auth)) {
      return matrixError(c, 'M_FORBIDDEN', 'Cross-signing reset requires verified auth')
    }

    const missingTypes = requiredResetTypes.filter(t => !incomingByType.has(t))
    if (missingTypes.length > 0) {
      return matrixError(c, 'M_INVALID_PARAM', `Cross-signing reset must provide full metadata, missing: ${missingTypes.join(', ')}`)
    }

    db.transaction((tx) => {
      tx.delete(accountData)
        .where(and(
          eq(accountData.userId, auth.userId),
          eq(accountData.roomId, ''),
          inArray(accountData.type, CROSS_SIGNING_ACCOUNT_DATA_TYPES),
        ))
        .run()

      for (const { dbType, keyData } of incoming) {
        tx.insert(accountData).values({
          userId: auth.userId,
          type: CROSS_SIGNING_ACCOUNT_DATA_TYPE[dbType],
          roomId: '',
          content: keyData,
        }).run()
      }
    })
  }
  else {
    for (const { dbType, keyData } of incoming) {
      await db.insert(accountData).values({
        userId: auth.userId,
        type: CROSS_SIGNING_ACCOUNT_DATA_TYPE[dbType],
        roomId: '',
        content: keyData,
      }).onConflictDoUpdate({
        target: [accountData.userId, accountData.type, accountData.roomId],
        set: { content: keyData },
      })
    }
  }

  db.insert(e2eeDeviceListChanges).values({
    userId: auth.userId,
    ulid: generateUlid(),
  }).run()
  notifyUser(auth.userId)

  return c.json({})
})
