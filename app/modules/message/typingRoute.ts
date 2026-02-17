import type { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { typingNotifications } from '@/db/schema'
import { getRoomId } from '@/modules/message/shared'

export function registerTypingRoute(router: Hono<AuthEnv>) {
  // PUT /rooms/:roomId/typing/:userId
  router.put('/:roomId/typing/:userId', async (c) => {
    const auth = c.get('auth')
    const roomId = getRoomId(c)
    const body = await c.req.json()

    if (body.typing) {
      const timeout = Math.min(body.timeout || 30000, 30000)
      db.insert(typingNotifications).values({
        roomId,
        userId: auth.userId,
        expiresAt: Date.now() + timeout,
      }).onConflictDoUpdate({
        target: [typingNotifications.roomId, typingNotifications.userId],
        set: { expiresAt: Date.now() + timeout },
      }).run()
    }
    else {
      db.delete(typingNotifications)
        .where(and(
          eq(typingNotifications.roomId, roomId),
          eq(typingNotifications.userId, auth.userId),
        ))
        .run()
    }

    return c.json({})
  })
}
