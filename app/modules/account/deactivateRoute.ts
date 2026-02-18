import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { accountData, accounts, accountTokens, devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, oauthTokens, roomMembers } from '@/db/schema'
import { CROSS_SIGNING_ACCOUNT_DATA_TYPES } from '@/modules/e2ee/crossSigningHelpers'
import { createEvent } from '@/modules/message/service'
import { authMiddleware } from '@/shared/middleware/auth'

export const deactivateRoute = new Hono<AuthEnv>()
deactivateRoute.use('/*', authMiddleware)

deactivateRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const userId = auth.userId

  const joinedRooms = db.transaction((tx) => {
    tx.update(accounts).set({ isDeactivated: true }).where(eq(accounts.id, userId)).run()

    const localpart = userId.split(':')[0]?.slice(1) || ''
    tx.delete(oauthTokens).where(eq(oauthTokens.accountId, localpart)).run()

    tx.delete(accountTokens).where(eq(accountTokens.userId, userId)).run()

    const rooms = tx.select({ roomId: roomMembers.roomId })
      .from(roomMembers)
      .where(and(
        eq(roomMembers.userId, userId),
        eq(roomMembers.membership, 'join'),
      ))
      .all()

    tx.delete(e2eeDeviceKeys).where(eq(e2eeDeviceKeys.userId, userId)).run()
    tx.delete(e2eeOneTimeKeys).where(eq(e2eeOneTimeKeys.userId, userId)).run()
    tx.delete(e2eeFallbackKeys).where(eq(e2eeFallbackKeys.userId, userId)).run()
    tx.delete(accountData).where(and(
      eq(accountData.userId, userId),
      eq(accountData.roomId, ''),
      inArray(accountData.type, CROSS_SIGNING_ACCOUNT_DATA_TYPES),
    )).run()

    tx.delete(devices).where(eq(devices.userId, userId)).run()

    return rooms
  })

  for (const { roomId } of joinedRooms) {
    createEvent({
      roomId,
      sender: userId,
      type: 'm.room.member',
      stateKey: userId,
      content: { membership: 'leave' },
    })
  }

  return c.json({ id_server_unbind_result: 'no-support' })
})
