import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { serverName } from '@/config'
import { db } from '@/db'
import { roomAliases, rooms } from '@/db/schema'
import { queryAppServiceRoomAlias } from '@/modules/appservice/service'
import { getRoomMembership } from '@/modules/room/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

// ---- Room Alias CRUD ----
export const roomAliasRoute = new Hono<AuthEnv>()

// PUT /:roomAlias — Create alias (requires auth)
roomAliasRoute.put('/:roomAlias', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const roomAlias = decodeURIComponent(c.req.param('roomAlias'))

  if (!roomAlias.startsWith('#') || !roomAlias.includes(':')) {
    return matrixError(c, 'M_INVALID_PARAM', 'Invalid room alias format')
  }

  const body = await c.req.json()
  const roomId = body.room_id
  if (!roomId) {
    return matrixError(c, 'M_MISSING_PARAM', 'Missing room_id')
  }

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room) {
    return matrixNotFound(c, 'Room not found')
  }

  const membership = getRoomMembership(roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  try {
    db.insert(roomAliases).values({ alias: roomAlias, roomId }).run()
  }
  catch {
    return c.json({ errcode: 'M_UNKNOWN', error: 'Room alias already exists' }, 409)
  }

  return c.json({})
})

// GET /:roomAlias — Resolve alias (public, no auth)
roomAliasRoute.get('/:roomAlias', async (c) => {
  const roomAlias = decodeURIComponent(c.req.param('roomAlias'))

  let alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomAlias)).get()
  if (!alias) {
    // Fallback: query application services
    const asRoomId = await queryAppServiceRoomAlias(roomAlias)
    if (asRoomId) {
      alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomAlias)).get()
    }
    if (!alias) {
      return matrixNotFound(c, 'Room alias not found')
    }
  }

  return c.json({ room_id: alias.roomId, servers: [serverName] })
})

// DELETE /:roomAlias — Delete alias (requires auth)
roomAliasRoute.delete('/:roomAlias', authMiddleware, async (c) => {
  const auth = c.get('auth')
  const roomAlias = decodeURIComponent(c.req.param('roomAlias'))

  const alias = db.select().from(roomAliases).where(eq(roomAliases.alias, roomAlias)).get()
  if (!alias) {
    return matrixNotFound(c, 'Room alias not found')
  }

  const membership = getRoomMembership(alias.roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  db.delete(roomAliases).where(eq(roomAliases.alias, roomAlias)).run()
  return c.json({})
})
