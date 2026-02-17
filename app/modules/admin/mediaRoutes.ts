import type { Hono } from 'hono'
import { count, eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { media, mediaDeletions } from '@/db/schema'
import { getAdminContext, logAdminAction } from './helpers'

export function registerAdminMediaRoutes(adminRoute: Hono) {
  // GET /api/media — List media
  adminRoute.get('/api/media', (c) => {
    const limit = Number(c.req.query('limit') || 50)
    const offset = Number(c.req.query('offset') || 0)
    const type = c.req.query('type')

    const where = type ? like(media.contentType, `%${type}%`) : undefined

    const rows = db.select().from(media).where(where).limit(limit).offset(offset).all()
    const total = db.select({ count: count() }).from(media).where(where).get()!

    return c.json({ media: rows, total: total.count })
  })

  // DELETE /api/media/:mediaId — Soft delete media (queue for background cleanup)
  adminRoute.delete('/api/media/:mediaId', async (c) => {
    const mediaId = c.req.param('mediaId')

    const record = db.select().from(media).where(eq(media.id, mediaId)).get()
    if (!record)
      return c.json({})

    // Insert into soft delete queue
    db.insert(mediaDeletions).values({
      mediaId,
      storagePath: record.storagePath,
    }).run()

    // Remove from media table (makes it inaccessible immediately)
    db.delete(media).where(eq(media.id, mediaId)).run()

    const { adminUserId, ip } = getAdminContext(c)
    logAdminAction(adminUserId, 'media.delete', 'media', mediaId, { contentType: record.contentType, userId: record.userId }, ip)

    return c.json({})
  })
}
