import { and, eq } from 'drizzle-orm'
import { maxRoomMembers, maxRoomsPerUser } from '@/config'
import { db } from '@/db'
import { roomMembers } from '@/db/schema'

export function checkUserRoomLimit(userId: string): boolean {
  if (maxRoomsPerUser <= 0)
    return true
  const count = db.select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.userId, userId), eq(roomMembers.membership, 'join')))
    .all()
    .length
  return count < maxRoomsPerUser
}

export function checkRoomMemberLimit(roomId: string): boolean {
  if (maxRoomMembers <= 0)
    return true
  const count = db.select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.membership, 'join')))
    .all()
    .length
  return count < maxRoomMembers
}
