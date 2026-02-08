import { Hono } from 'hono'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { createRoom } from '@/services/rooms'

export const createRoomRoute = new Hono()

createRoomRoute.use('/*', authMiddleware)

createRoomRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json()

  const roomId = createRoom({
    creatorId: auth.userId,
    name: body.name,
    topic: body.topic,
    roomAliasName: body.room_alias_name,
    visibility: body.visibility,
    preset: body.preset,
    isDirect: body.is_direct,
    invite: body.invite,
    initialState: body.initial_state,
    powerLevelContentOverride: body.power_level_content_override,
  })

  return c.json({ room_id: roomId })
})
