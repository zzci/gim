import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

export const testRoute = new Hono()

testRoute.get('/', async (c) => {
  try {
    const userCount = await db.select({ count: sql<number>`count(*)` }).from(users)
    return c.json({
      ok: true,
      db: 'connected',
      users: userCount[0]?.count ?? 0,
    })
  }
  catch (error) {
    logger.error(error)
    return c.json({ ok: false, error: String(error) })
  }
})
