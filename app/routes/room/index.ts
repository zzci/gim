import { syncRoute } from './sync'
import { createRoomRoute } from './create'
import { joinRoute } from './join'
import { joinedRoomsRoute } from './joinedRooms'
import { roomsRouter } from './roomsRouter'

export const room = {
  syncRoute,
  createRoomRoute,
  joinRoute,
  joinedRoomsRoute,
  roomsRouter,
}
