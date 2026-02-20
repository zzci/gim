import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { getRoomId } from '@/modules/message/shared'
import { getRoomMembership } from '@/modules/room/service'
import { queryRoomEvents } from '@/shared/helpers/eventQueries'
import { formatEventListWithRelations } from '@/shared/helpers/formatEvent'
import { matrixForbidden } from '@/shared/middleware/errors'

export function registerMessagesRoute(router: Hono<AuthEnv>) {
  // GET /rooms/:roomId/messages
  router.get('/:roomId/messages', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const from = c.req.query('from')
    const dir = c.req.query('dir') || 'b'
    const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 100)

    const membership = await getRoomMembership(roomId, auth.userId)
    if (membership !== 'join' && membership !== 'invite') {
      return matrixForbidden(c, 'Not a member of this room')
    }

    const rows = queryRoomEvents(roomId, {
      ...(dir === 'b' && from ? { before: from } : {}),
      ...(dir === 'f' && from ? { after: from } : {}),
      order: dir === 'b' ? 'desc' : 'asc',
      limit,
    })

    const chunk = formatEventListWithRelations(rows)

    const startToken = from || (rows[0] ? rows[0].id : '0')
    const endToken = rows.length > 0 ? rows[rows.length - 1]!.id : startToken

    return c.json({ start: startToken, end: endToken, chunk })
  })
}
