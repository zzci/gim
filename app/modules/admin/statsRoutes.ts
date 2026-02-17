import type { Hono } from 'hono'
import { count, gte, sql } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, eventsState, eventsTimeline, media, rooms } from '@/db/schema'

export function registerAdminStatsRoutes(adminRoute: Hono) {
  // GET /api/stats — Server statistics
  adminRoute.get('/api/stats', (c) => {
    const userCount = db.select({ count: count() }).from(accounts).get()!
    const roomCount = db.select({ count: count() }).from(rooms).get()!
    const stateEventCount = db.select({ count: count() }).from(eventsState).get()!
    const timelineEventCount = db.select({ count: count() }).from(eventsTimeline).get()!
    const mediaCount = db.select({ count: count() }).from(media).get()!

    return c.json({
      users: userCount.count,
      rooms: roomCount.count,
      events: stateEventCount.count + timelineEventCount.count,
      media: mediaCount.count,
    })
  })

  // GET /api/stats/history — 30-day trend data
  adminRoute.get('/api/stats/history', (c) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

    const users = db
      .select({
        date: sql<string>`DATE(${accounts.createdAt} / 1000, 'unixepoch')`,
        count: count(),
      })
      .from(accounts)
      .where(gte(accounts.createdAt, new Date(thirtyDaysAgo)))
      .groupBy(sql`DATE(${accounts.createdAt} / 1000, 'unixepoch')`)
      .orderBy(sql`DATE(${accounts.createdAt} / 1000, 'unixepoch')`)
      .all()

    const roomHistory = db
      .select({
        date: sql<string>`DATE(${rooms.createdAt} / 1000, 'unixepoch')`,
        count: count(),
      })
      .from(rooms)
      .where(gte(rooms.createdAt, new Date(thirtyDaysAgo)))
      .groupBy(sql`DATE(${rooms.createdAt} / 1000, 'unixepoch')`)
      .orderBy(sql`DATE(${rooms.createdAt} / 1000, 'unixepoch')`)
      .all()

    const mediaHistory = db
      .select({
        date: sql<string>`DATE(${media.createdAt} / 1000, 'unixepoch')`,
        count: count(),
      })
      .from(media)
      .where(gte(media.createdAt, new Date(thirtyDaysAgo)))
      .groupBy(sql`DATE(${media.createdAt} / 1000, 'unixepoch')`)
      .orderBy(sql`DATE(${media.createdAt} / 1000, 'unixepoch')`)
      .all()

    const messages = db
      .select({
        date: sql<string>`DATE(${eventsTimeline.originServerTs} / 1000, 'unixepoch')`,
        count: count(),
      })
      .from(eventsTimeline)
      .where(gte(eventsTimeline.originServerTs, thirtyDaysAgo))
      .groupBy(sql`DATE(${eventsTimeline.originServerTs} / 1000, 'unixepoch')`)
      .orderBy(sql`DATE(${eventsTimeline.originServerTs} / 1000, 'unixepoch')`)
      .all()

    return c.json({
      users,
      rooms: roomHistory,
      media: mediaHistory,
      messages,
    })
  })
}
