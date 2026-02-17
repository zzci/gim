import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { roomMembers } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

// GET / — mounted at /_matrix/client/v3/joined_rooms
export const joinedRoomsRoute = new Hono<AuthEnv>()
joinedRoomsRoute.use('/*', authMiddleware)

joinedRoomsRoute.get('/', async (c) => {
  const auth = c.get('auth')
  const rows = db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.userId, auth.userId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()
  return c.json({ joined_rooms: rows.map(r => r.roomId) })
})
