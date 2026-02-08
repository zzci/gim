import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { roomMembers } from '@/db/schema'
import { authMiddleware, type AuthContext } from '@/middleware/auth'

export const joinedRoomsRoute = new Hono()

joinedRoomsRoute.use('/*', authMiddleware)

joinedRoomsRoute.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext

  const rows = db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(
      eq(roomMembers.userId, auth.userId),
      eq(roomMembers.membership, 'join'),
    ))
    .all()

  return c.json({
    joined_rooms: rows.map(r => r.roomId),
  })
})
