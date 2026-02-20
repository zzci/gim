import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { maxRoomsPerUser } from '@/config'
import { createRoom } from '@/modules/room/service'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError } from '@/shared/middleware/errors'
import { createRoomBody, validate } from '@/shared/validation'
import { checkUserRoomLimit } from './limits'

// POST / — mounted at /_matrix/client/v3/createRoom
export const createRoomRoute = new Hono<AuthEnv>()
createRoomRoute.use('/*', authMiddleware)

createRoomRoute.post('/', async (c) => {
  const auth = c.get('auth')
  if (!await checkUserRoomLimit(auth.userId)) {
    return matrixError(c, 'M_RESOURCE_LIMIT_EXCEEDED', `You have reached the maximum number of rooms (${maxRoomsPerUser})`)
  }
  const body = await c.req.json()

  const v = validate(c, createRoomBody, body)
  if (!v.success)
    return v.response

  const roomId = await createRoom({
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
