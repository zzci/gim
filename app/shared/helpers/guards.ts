import type { Context } from 'hono'
import { getRoomMembership, getUserPowerLevel } from '@/modules/room/service'
import { matrixForbidden } from '@/shared/middleware/errors'

/**
 * Check that the user has one of the allowed memberships in the room.
 * Returns an error response if not, or null if the check passes.
 */
export function requireMembership(
  c: Context,
  roomId: string,
  userId: string,
  allowed: string[],
): Response | null {
  const membership = getRoomMembership(roomId, userId)
  if (!membership || !allowed.includes(membership)) {
    return matrixForbidden(c, 'Not a member of this room') as unknown as Response
  }
  return null
}

/**
 * Check that the sender has sufficient power level compared to the target.
 * Returns an error response if insufficient, or null if the check passes.
 */
export function requirePowerLevel(
  c: Context,
  roomId: string,
  senderId: string,
  targetUserId: string,
): Response | null {
  const senderPower = getUserPowerLevel(roomId, senderId)
  const targetPower = getUserPowerLevel(roomId, targetUserId)
  if (senderPower <= targetPower) {
    return matrixForbidden(c, 'Insufficient power level') as unknown as Response
  }
  return null
}
