import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { serverName } from '@/config'
import { db } from '@/db'
import { roomAliases, rooms } from '@/db/schema'
import { getMembership } from '@/models/roomMembership'
import { getActionPowerLevel, getStateContent, getUserPowerLevel } from '@/models/roomState'
import { queryAppServiceRoomAlias } from '@/modules/appservice/service'
import { createEvent } from '@/modules/message/service'
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

  const membership = getMembership(roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  const userPower = getUserPowerLevel(roomId, auth.userId)
  const requiredPower = getActionPowerLevel(roomId, 'state_default')
  if (userPower < requiredPower) {
    return matrixForbidden(c, 'Insufficient power level to create room alias')
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

  const membership = getMembership(alias.roomId, auth.userId)
  if (membership !== 'join') {
    return matrixForbidden(c, 'Not a member of this room')
  }

  db.delete(roomAliases).where(eq(roomAliases.alias, roomAlias)).run()

  // Clean up m.room.canonical_alias if the deleted alias was published
  const canonicalContent = getStateContent(alias.roomId, 'm.room.canonical_alias', '')

  if (canonicalContent) {
    const content = canonicalContent as { alias?: string, alt_aliases?: string[] }

    const wasCanonical = content.alias === roomAlias
    const altAliases = (content.alt_aliases ?? []).filter((a: string) => a !== roomAlias)
    const hadAlt = altAliases.length !== (content.alt_aliases ?? []).length

    if (wasCanonical || hadAlt) {
      const newContent: { alias?: string, alt_aliases?: string[] } = {}
      if (wasCanonical) {
        // Promote first alt_alias to canonical, or leave unset
        if (altAliases.length > 0)
          newContent.alias = altAliases.shift()
      }
      else {
        newContent.alias = content.alias
      }
      if (altAliases.length > 0)
        newContent.alt_aliases = altAliases

      createEvent({
        roomId: alias.roomId,
        sender: auth.userId,
        type: 'm.room.canonical_alias',
        stateKey: '',
        content: newContent,
      })
    }
  }

  return c.json({})
})
