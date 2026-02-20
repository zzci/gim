import type { Hono } from 'hono'
import { and, count, eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, devices, roomMembers } from '@/db/schema'
import { invalidateDeactivatedCache } from '@/models/account'
import { getAdminContext, logAdminAction } from './helpers'

export function registerAdminUsersRoutes(adminRoute: Hono) {
  // GET /api/users — Paginated user list
  adminRoute.get('/api/users', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 1000)
    const offset = Math.max(Number(c.req.query('offset') || 0), 0)
    const search = c.req.query('search')

    // Use prefix match for @user:server format (can use primary key index)
    const where = search
      ? like(accounts.id, search.startsWith('@') ? `${search}%` : `%${search}%`)
      : undefined

    const rows = db
      .select({
        id: accounts.id,
        createdAt: accounts.createdAt,
        isGuest: accounts.isGuest,
        isDeactivated: accounts.isDeactivated,
        admin: accounts.admin,
        displayname: accounts.displayname,
      })
      .from(accounts)
      .where(where)
      .limit(limit)
      .offset(offset)
      .all()

    const total = db.select({ count: count() }).from(accounts).where(where).get()!

    return c.json({ users: rows, total: total.count })
  })

  // GET /api/users/:userId — User details
  adminRoute.get('/api/users/:userId', (c) => {
    const userId = c.req.param('userId')

    const account = db.select().from(accounts).where(eq(accounts.id, userId)).get()
    if (!account)
      return c.json({ errcode: 'M_NOT_FOUND', error: 'User not found' }, 404)

    const userDevices = db.select().from(devices).where(eq(devices.userId, userId)).all()
    const userRooms = db
      .select({ roomId: roomMembers.roomId, membership: roomMembers.membership })
      .from(roomMembers)
      .where(and(eq(roomMembers.userId, userId), eq(roomMembers.membership, 'join')))
      .all()

    return c.json({ account, devices: userDevices, rooms: userRooms })
  })

  // PUT /api/users/:userId — Update user
  adminRoute.put('/api/users/:userId', async (c) => {
    const userId = c.req.param('userId')
    const body = await c.req.json<{ admin?: boolean, isDeactivated?: boolean }>()

    const account = db.select().from(accounts).where(eq(accounts.id, userId)).get()
    if (!account)
      return c.json({ errcode: 'M_NOT_FOUND', error: 'User not found' }, 404)

    const updates: Record<string, unknown> = {}
    if (typeof body.admin === 'boolean')
      updates.admin = body.admin
    if (typeof body.isDeactivated === 'boolean')
      updates.isDeactivated = body.isDeactivated

    if (Object.keys(updates).length > 0) {
      db.update(accounts).set(updates).where(eq(accounts.id, userId)).run()
      if (typeof body.isDeactivated === 'boolean') {
        await invalidateDeactivatedCache(userId)
      }
    }

    const { adminUserId, ip } = getAdminContext(c)
    if (typeof body.isDeactivated === 'boolean') {
      logAdminAction(adminUserId, body.isDeactivated ? 'user.deactivate' : 'user.reactivate', 'user', userId, updates, ip)
    }
    if (typeof body.admin === 'boolean') {
      logAdminAction(adminUserId, body.admin ? 'user.grant_admin' : 'user.revoke_admin', 'user', userId, updates, ip)
    }

    const updated = db.select().from(accounts).where(eq(accounts.id, userId)).get()
    return c.json(updated)
  })
}
