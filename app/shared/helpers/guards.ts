import type { Context } from 'hono'
import { getMembership } from '@/models/roomMembership'
import { getUserPowerLevel } from '@/models/roomState'
import { matrixForbidden } from '@/shared/middleware/errors'

/**
 * Check that the user has one of the allowed memberships in the room.
 * Returns an error response if not, or null if the check passes.
 */
export async function requireMembership(
  c: Context,
  roomId: string,
  userId: string,
  allowed: string[],
): Promise<Response | null> {
  const membership = await getMembership(roomId, userId)
  if (!membership || !allowed.includes(membership)) {
    return matrixForbidden(c, 'Not a member of this room') as unknown as Response
  }
  return null
}

/**
 * Check that the sender has sufficient power level compared to the target.
 * Returns an error response if insufficient, or null if the check passes.
 */
export async function requirePowerLevel(
  c: Context,
  roomId: string,
  senderId: string,
  targetUserId: string,
): Promise<Response | null> {
  const senderPower = await getUserPowerLevel(roomId, senderId)
  const targetPower = await getUserPowerLevel(roomId, targetUserId)
  if (senderPower <= targetPower) {
    return matrixForbidden(c, 'Insufficient power level') as unknown as Response
  }
  return null
}
