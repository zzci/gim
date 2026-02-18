import type { AuthEnv } from '@/shared/middleware/auth'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { e2eeKeyBackupEnabled } from '@/config'
import { db } from '@/db'
import { e2eeRoomKeyBackupKeys, e2eeRoomKeyBackups } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'

type BackupSession = Record<string, unknown>

export const roomKeysRoute = new Hono<AuthEnv>()
roomKeysRoute.use('/*', authMiddleware)

function backupDisabled(c: any) {
  return c.json({ errcode: 'M_NOT_FOUND', error: 'No backup found' }, 404)
}

async function getBackupCount(userId: string, version: string): Promise<number> {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(e2eeRoomKeyBackupKeys)
    .where(and(eq(e2eeRoomKeyBackupKeys.userId, userId), eq(e2eeRoomKeyBackupKeys.version, version)))
    .get()
  return Number(row?.count || 0)
}

function getLatestBackup(userId: string) {
  return db
    .select()
    .from(e2eeRoomKeyBackups)
    .where(eq(e2eeRoomKeyBackups.userId, userId))
    .orderBy(desc(e2eeRoomKeyBackups.createdAt))
    .get()
}

function getBackupByVersion(userId: string, version: string) {
  return db
    .select()
    .from(e2eeRoomKeyBackups)
    .where(and(eq(e2eeRoomKeyBackups.userId, userId), eq(e2eeRoomKeyBackups.version, version)))
    .get()
}

function parseRequestedVersion(c: any, userId: string): string | null {
  const requested = c.req.query('version')
  if (requested)
    return requested
  return getLatestBackup(userId)?.version || null
}

function formatVersionResponse(backup: any, count: number) {
  return {
    algorithm: backup.algorithm,
    auth_data: backup.authData || {},
    count,
    etag: String(backup.etag || 0),
    version: backup.version,
  }
}

function normalizeRoomsPayload(body: Record<string, unknown>, roomId?: string, sessionId?: string): Record<string, Record<string, BackupSession>> {
  if (roomId && sessionId) {
    return { [roomId]: { [sessionId]: body as BackupSession } }
  }

  if (roomId) {
    const sessions = (body.sessions || {}) as Record<string, BackupSession>
    return { [roomId]: sessions }
  }

  const rooms = (body.rooms || {}) as Record<string, { sessions?: Record<string, BackupSession> }>
  const normalized: Record<string, Record<string, BackupSession>> = {}
  for (const [rid, room] of Object.entries(rooms)) {
    normalized[rid] = room.sessions || {}
  }
  return normalized
}

function buildRoomsResponse(rows: Array<{ roomId: string, sessionId: string, keyData: BackupSession }>) {
  const rooms: Record<string, { sessions: Record<string, BackupSession> }> = {}
  for (const row of rows) {
    if (!rooms[row.roomId])
      rooms[row.roomId] = { sessions: {} }
    rooms[row.roomId]!.sessions[row.sessionId] = row.keyData
  }
  return { rooms }
}

async function storeBackupKeys(userId: string, version: string, rooms: Record<string, Record<string, BackupSession>>) {
  let changed = 0
  const now = new Date()
  db.transaction((tx) => {
    for (const [roomId, sessions] of Object.entries(rooms)) {
      for (const [sessionId, keyData] of Object.entries(sessions)) {
        tx.insert(e2eeRoomKeyBackupKeys)
          .values({ userId, version, roomId, sessionId, keyData, updatedAt: now })
          .onConflictDoUpdate({
            target: [e2eeRoomKeyBackupKeys.userId, e2eeRoomKeyBackupKeys.version, e2eeRoomKeyBackupKeys.roomId, e2eeRoomKeyBackupKeys.sessionId],
            set: { keyData, updatedAt: now },
          })
          .run()
        changed++
      }
    }

    if (changed > 0) {
      tx.update(e2eeRoomKeyBackups)
        .set({ etag: sql`${e2eeRoomKeyBackups.etag} + 1`, updatedAt: now })
        .where(and(eq(e2eeRoomKeyBackups.userId, userId), eq(e2eeRoomKeyBackups.version, version)))
        .run()
    }
  })
}

function deleteBackupKeys(userId: string, version: string, roomId?: string, sessionId?: string) {
  const now = new Date()
  let changed = 0
  db.transaction((tx) => {
    if (roomId && sessionId) {
      const res = tx.delete(e2eeRoomKeyBackupKeys).where(and(
        eq(e2eeRoomKeyBackupKeys.userId, userId),
        eq(e2eeRoomKeyBackupKeys.version, version),
        eq(e2eeRoomKeyBackupKeys.roomId, roomId),
        eq(e2eeRoomKeyBackupKeys.sessionId, sessionId),
      )).run()
      changed += res.changes
    }
    else if (roomId) {
      const res = tx.delete(e2eeRoomKeyBackupKeys).where(and(
        eq(e2eeRoomKeyBackupKeys.userId, userId),
        eq(e2eeRoomKeyBackupKeys.version, version),
        eq(e2eeRoomKeyBackupKeys.roomId, roomId),
      )).run()
      changed += res.changes
    }
    else {
      const res = tx.delete(e2eeRoomKeyBackupKeys).where(and(
        eq(e2eeRoomKeyBackupKeys.userId, userId),
        eq(e2eeRoomKeyBackupKeys.version, version),
      )).run()
      changed += res.changes
    }

    if (changed > 0) {
      tx.update(e2eeRoomKeyBackups)
        .set({ etag: sql`${e2eeRoomKeyBackups.etag} + 1`, updatedAt: now })
        .where(and(eq(e2eeRoomKeyBackups.userId, userId), eq(e2eeRoomKeyBackups.version, version)))
        .run()
    }
  })
}

roomKeysRoute.get('/version', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)

  const auth = c.get('auth')
  const backup = getLatestBackup(auth.userId)
  if (!backup)
    return backupDisabled(c)
  const count = await getBackupCount(auth.userId, backup.version)
  return c.json(formatVersionResponse(backup, count))
})

roomKeysRoute.post('/version', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)

  const auth = c.get('auth')
  const body = await c.req.json<Record<string, unknown>>()
  const algorithm = typeof body.algorithm === 'string' ? body.algorithm : null
  if (!algorithm)
    return matrixError(c, 'M_BAD_JSON', 'Missing algorithm')

  const maxRow = db
    .select({ version: e2eeRoomKeyBackups.version })
    .from(e2eeRoomKeyBackups)
    .where(eq(e2eeRoomKeyBackups.userId, auth.userId))
    .orderBy(desc(e2eeRoomKeyBackups.createdAt))
    .get()

  const nextVersion = String((maxRow ? Number(maxRow.version) : 0) + 1)
  const now = new Date()
  db.insert(e2eeRoomKeyBackups).values({
    userId: auth.userId,
    version: nextVersion,
    algorithm,
    authData: (body.auth_data || {}) as Record<string, unknown>,
    createdAt: now,
    updatedAt: now,
  }).run()
  return c.json({ version: nextVersion })
})

roomKeysRoute.get('/version/:version', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)

  const auth = c.get('auth')
  const version = c.req.param('version')
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)
  const count = await getBackupCount(auth.userId, version)
  return c.json(formatVersionResponse(backup, count))
})

roomKeysRoute.put('/version/:version', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)

  const auth = c.get('auth')
  const version = c.req.param('version')
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const body = await c.req.json<Record<string, unknown>>()
  const algorithm = typeof body.algorithm === 'string' ? body.algorithm : backup.algorithm
  const authData = (body.auth_data || backup.authData || {}) as Record<string, unknown>
  db.update(e2eeRoomKeyBackups)
    .set({ algorithm, authData, etag: sql`${e2eeRoomKeyBackups.etag} + 1`, updatedAt: new Date() })
    .where(and(eq(e2eeRoomKeyBackups.userId, auth.userId), eq(e2eeRoomKeyBackups.version, version)))
    .run()

  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json(formatVersionResponse(updated, count))
})

roomKeysRoute.delete('/version/:version', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)

  const auth = c.get('auth')
  const version = c.req.param('version')
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  db.transaction((tx) => {
    tx.delete(e2eeRoomKeyBackupKeys).where(and(
      eq(e2eeRoomKeyBackupKeys.userId, auth.userId),
      eq(e2eeRoomKeyBackupKeys.version, version),
    )).run()
    tx.delete(e2eeRoomKeyBackups).where(and(
      eq(e2eeRoomKeyBackups.userId, auth.userId),
      eq(e2eeRoomKeyBackups.version, version),
    )).run()
  })
  return c.json({})
})

roomKeysRoute.get('/keys', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const rows = db.select({
    roomId: e2eeRoomKeyBackupKeys.roomId,
    sessionId: e2eeRoomKeyBackupKeys.sessionId,
    keyData: e2eeRoomKeyBackupKeys.keyData,
  }).from(e2eeRoomKeyBackupKeys).where(and(
    eq(e2eeRoomKeyBackupKeys.userId, auth.userId),
    eq(e2eeRoomKeyBackupKeys.version, version),
  )).all()
  return c.json(buildRoomsResponse(rows))
})

roomKeysRoute.get('/keys/:roomId', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const roomId = c.req.param('roomId')
  const rows = db.select({
    roomId: e2eeRoomKeyBackupKeys.roomId,
    sessionId: e2eeRoomKeyBackupKeys.sessionId,
    keyData: e2eeRoomKeyBackupKeys.keyData,
  }).from(e2eeRoomKeyBackupKeys).where(and(
    eq(e2eeRoomKeyBackupKeys.userId, auth.userId),
    eq(e2eeRoomKeyBackupKeys.version, version),
    eq(e2eeRoomKeyBackupKeys.roomId, roomId),
  )).all()
  return c.json(buildRoomsResponse(rows))
})

roomKeysRoute.get('/keys/:roomId/:sessionId', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const roomId = c.req.param('roomId')
  const sessionId = c.req.param('sessionId')
  const row = db.select({ keyData: e2eeRoomKeyBackupKeys.keyData }).from(e2eeRoomKeyBackupKeys).where(and(
    eq(e2eeRoomKeyBackupKeys.userId, auth.userId),
    eq(e2eeRoomKeyBackupKeys.version, version),
    eq(e2eeRoomKeyBackupKeys.roomId, roomId),
    eq(e2eeRoomKeyBackupKeys.sessionId, sessionId),
  )).get()
  if (!row)
    return matrixError(c, 'M_NOT_FOUND', 'No room key found')
  return c.json(row.keyData)
})

roomKeysRoute.put('/keys', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const body = await c.req.json<Record<string, unknown>>()
  const normalized = normalizeRoomsPayload(body)
  await storeBackupKeys(auth.userId, version, normalized)
  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json({ count, etag: String(updated.etag || 0) })
})

roomKeysRoute.put('/keys/:roomId', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const roomId = c.req.param('roomId')
  const body = await c.req.json<Record<string, unknown>>()
  const normalized = normalizeRoomsPayload(body, roomId)
  await storeBackupKeys(auth.userId, version, normalized)
  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json({ count, etag: String(updated.etag || 0) })
})

roomKeysRoute.put('/keys/:roomId/:sessionId', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const roomId = c.req.param('roomId')
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json<Record<string, unknown>>()
  const normalized = normalizeRoomsPayload(body, roomId, sessionId)
  await storeBackupKeys(auth.userId, version, normalized)
  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json({ count, etag: String(updated.etag || 0) })
})

roomKeysRoute.delete('/keys', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  deleteBackupKeys(auth.userId, version)
  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json({ count, etag: String(updated.etag || 0) })
})

roomKeysRoute.delete('/keys/:roomId', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const roomId = c.req.param('roomId')
  deleteBackupKeys(auth.userId, version, roomId)
  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json({ count, etag: String(updated.etag || 0) })
})

roomKeysRoute.delete('/keys/:roomId/:sessionId', async (c) => {
  if (!e2eeKeyBackupEnabled)
    return backupDisabled(c)
  const auth = c.get('auth')
  const version = parseRequestedVersion(c, auth.userId)
  if (!version)
    return backupDisabled(c)
  const backup = getBackupByVersion(auth.userId, version)
  if (!backup)
    return backupDisabled(c)

  const roomId = c.req.param('roomId')
  const sessionId = c.req.param('sessionId')
  deleteBackupKeys(auth.userId, version, roomId, sessionId)
  const updated = getBackupByVersion(auth.userId, version)!
  const count = await getBackupCount(auth.userId, version)
  return c.json({ count, etag: String(updated.etag || 0) })
})
