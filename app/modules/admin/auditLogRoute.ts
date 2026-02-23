import type { Hono } from 'hono'
import { count, desc } from 'drizzle-orm'
import { db } from '@/db'
import { adminAuditLog } from '@/db/schema'

export function registerAdminAuditLogRoute(adminRoute: Hono) {
  // GET /api/audit-log — Paginated audit log
  adminRoute.get('/api/audit-log', (c) => {
    const limit = Number(c.req.query('limit') || 50)
    const offset = Number(c.req.query('offset') || 0)

    const rows = db
      .select()
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit)
      .offset(offset)
      .all()

    const total = db.select({ count: count() }).from(adminAuditLog).get()!

    return c.json({ entries: rows, total: total.count })
  })
}
