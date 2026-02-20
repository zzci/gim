import { maxRoomMembers, maxRoomsPerUser } from '@/config'
import { getJoinedMemberCount, getJoinedRoomIds } from '@/models/roomMembership'

export async function checkUserRoomLimit(userId: string): Promise<boolean> {
  if (maxRoomsPerUser <= 0)
    return true
  return getJoinedRoomIds(userId).length < maxRoomsPerUser
}

export async function checkRoomMemberLimit(roomId: string): Promise<boolean> {
  if (maxRoomMembers <= 0)
    return true
  return await getJoinedMemberCount(roomId) < maxRoomMembers
}
