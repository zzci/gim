import { maxRoomMembers, maxRoomsPerUser } from '@/config'
import { getJoinedMemberCount, getJoinedRoomIds } from '@/models/roomMembership'

export function checkUserRoomLimit(userId: string): boolean {
  if (maxRoomsPerUser <= 0)
    return true
  return getJoinedRoomIds(userId).length < maxRoomsPerUser
}

export function checkRoomMemberLimit(roomId: string): boolean {
  if (maxRoomMembers <= 0)
    return true
  return getJoinedMemberCount(roomId) < maxRoomMembers
}
