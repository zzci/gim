import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '@/db'
import { keyBackupVersions, keyBackupData } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound } from '@/middleware/errors'

export const roomKeysVersionRoute = new Hono()

roomKeysVersionRoute.use('/*', authMiddleware)

// GET /room_keys/version - get latest backup version
roomKeysVersionRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext

  const latest = db.select().from(keyBackupVersions)
    .where(eq(keyBackupVersions.userId, auth.userId))
    .orderBy(desc(keyBackupVersions.version))
    .limit(1)
    .get()

  if (!latest) {
    return matrixNotFound(c, 'No backup version found')
  }

  return c.json({
    algorithm: latest.algorithm,
    auth_data: latest.authData,
    version: latest.version,
    etag: latest.etag,
    count: latest.count,
  })
})

// GET /room_keys/version/:version
roomKeysVersionRoute.get('/:version', async (c) => {
  const auth = c.get('auth') as AuthContext
  const version = c.req.param('version')

  const backup = db.select().from(keyBackupVersions)
    .where(and(
      eq(keyBackupVersions.userId, auth.userId),
      eq(keyBackupVersions.version, version),
    ))
    .get()

  if (!backup) {
    return matrixNotFound(c, 'Backup version not found')
  }

  return c.json({
    algorithm: backup.algorithm,
    auth_data: backup.authData,
    version: backup.version,
    etag: backup.etag,
    count: backup.count,
  })
})

// POST /room_keys/version - create new backup version
roomKeysVersionRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json()

  // Generate version number
  const latest = db.select().from(keyBackupVersions)
    .where(eq(keyBackupVersions.userId, auth.userId))
    .orderBy(desc(keyBackupVersions.version))
    .limit(1)
    .get()

  const newVersion = String((Number.parseInt(latest?.version || '0') || 0) + 1)

  await db.insert(keyBackupVersions).values({
    version: newVersion,
    userId: auth.userId,
    algorithm: body.algorithm,
    authData: body.auth_data,
    etag: '0',
    count: 0,
  })

  return c.json({ version: newVersion })
})

// PUT /room_keys/version/:version - update backup version
roomKeysVersionRoute.put('/:version', async (c) => {
  const auth = c.get('auth') as AuthContext
  const version = c.req.param('version')
  const body = await c.req.json()

  await db.update(keyBackupVersions)
    .set({
      algorithm: body.algorithm,
      authData: body.auth_data,
    })
    .where(and(
      eq(keyBackupVersions.userId, auth.userId),
      eq(keyBackupVersions.version, version),
    ))

  return c.json({})
})

// DELETE /room_keys/version/:version
roomKeysVersionRoute.delete('/:version', async (c) => {
  const auth = c.get('auth') as AuthContext
  const version = c.req.param('version')

  await db.delete(keyBackupData)
    .where(and(
      eq(keyBackupData.userId, auth.userId),
      eq(keyBackupData.version, version),
    ))

  await db.delete(keyBackupVersions)
    .where(and(
      eq(keyBackupVersions.userId, auth.userId),
      eq(keyBackupVersions.version, version),
    ))

  return c.json({})
})
