import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { getJoinedRoomIds } from '@/models/roomMembership'
import { authMiddleware } from '@/shared/middleware/auth'

// GET / — mounted at /_matrix/client/v3/joined_rooms
export const joinedRoomsRoute = new Hono<AuthEnv>()
joinedRoomsRoute.use('/*', authMiddleware)

joinedRoomsRoute.get('/', async (c) => {
  const auth = c.get('auth')
  return c.json({ joined_rooms: getJoinedRoomIds(auth.userId) })
})
