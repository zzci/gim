import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { roomAliases } from '@/db/schema'
import { getRoomSummary } from '@/modules/room/service'
import { tryExtractUserId } from '@/modules/room/shared'
import { matrixNotFound } from '@/shared/middleware/errors'

// ---- Room Summary (MSC3266) ----
export const roomSummaryRoute = new Hono()

roomSummaryRoute.get('/:roomIdOrAlias/summary', async (c) => {
  const rawId = decodeURIComponent(c.req.param('roomIdOrAlias'))

  // Resolve alias to room ID
  let roomId = rawId
  if (rawId.startsWith('#')) {
    const alias = db.select({ roomId: roomAliases.roomId })
      .from(roomAliases)
      .where(eq(roomAliases.alias, rawId))
      .get()
    if (!alias)
      return matrixNotFound(c, 'Room alias not found')
    roomId = alias.roomId
  }

  const userId = await tryExtractUserId(c)
  const summary = await getRoomSummary(roomId, userId)
  if (!summary)
    return matrixNotFound(c, 'Room not found or not accessible')

  return c.json(summary)
})
