import { and, count, desc, eq, like, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, accountTokens, adminAuditLog, devices, eventsState, eventsTimeline, media, mediaDeletions, oauthTokens, roomMembers, rooms } from '@/db/schema'
import { adminMiddleware } from './middleware'

function logAdminAction(
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown> | null,
  ipAddress: string | null,
) {
  db.insert(adminAuditLog).values({
    adminUserId,
    action,
    targetType,
    targetId,
    details,
    ipAddress,
  }).run()
}

function getAdminContext(c: { get: (key: string) => unknown, req: { header: (name: string) => string | undefined } }) {
  const auth = c.get('auth') as { userId: string }
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null
  return { adminUserId: auth.userId, ip }
}

export const adminRoute = new Hono()

// POST /api/login — validate token and set httpOnly cookie
adminRoute.post('/api/login', async (c) => {
  const body = await c.req.json<{ token: string }>()
  const token = body.token?.trim()
  if (!token) {
    return c.json({ error: 'Missing token' }, 400)
  }

  // Validate the token works by checking it against auth stores
  const oauthRow = db.select({ accountId: oauthTokens.accountId, expiresAt: oauthTokens.expiresAt })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.id, `AccessToken:${token}`), eq(oauthTokens.type, 'AccessToken')))
    .get()

  const userTokenRow = !oauthRow
    ? db.select({ userId: accountTokens.userId }).from(accountTokens).where(eq(accountTokens.token, token)).get()
    : null

  if (!oauthRow && !userTokenRow) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  if (oauthRow?.expiresAt && oauthRow.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'Token expired' }, 401)
  }

  // Resolve userId and check admin flag
  let userId: string
  if (oauthRow) {
    const accountId = oauthRow.accountId!
    userId = accountId.startsWith('@') ? accountId : `@${accountId}:${serverName}`
  }
  else {
    userId = userTokenRow!.userId
  }

  const account = db.select({ admin: accounts.admin }).from(accounts).where(eq(accounts.id, userId)).get()
  if (!account?.admin) {
    return c.json({ error: 'Admin access required' }, 403)
  }

  setCookie(c, 'admin_token', token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/admin',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  })

  return c.json({ ok: true })
})

// POST /api/logout — clear the httpOnly cookie
adminRoute.post('/api/logout', (c) => {
  setCookie(c, 'admin_token', '', {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/admin',
    maxAge: 0,
  })
  return c.json({ ok: true })
})

adminRoute.use('/api/*', adminMiddleware)

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

// GET /api/users — Paginated user list
adminRoute.get('/api/users', (c) => {
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
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

// GET /api/rooms — Paginated room list
adminRoute.get('/api/rooms', (c) => {
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const search = c.req.query('search')

  // Use prefix match for !room:server format (can use primary key index)
  const where = search
    ? like(rooms.id, search.startsWith('!') ? `${search}%` : `%${search}%`)
    : undefined

  const rows = db
    .select({
      id: rooms.id,
      version: rooms.version,
      creatorId: rooms.creatorId,
      isDirect: rooms.isDirect,
      createdAt: rooms.createdAt,
      memberCount: sql<number>`(SELECT COUNT(*) FROM room_members WHERE room_id = ${rooms.id} AND membership = 'join')`,
    })
    .from(rooms)
    .where(where)
    .limit(limit)
    .offset(offset)
    .all()

  const total = db.select({ count: count() }).from(rooms).where(where).get()!

  return c.json({ rooms: rows, total: total.count })
})

// GET /api/rooms/:roomId — Room details
adminRoute.get('/api/rooms/:roomId', (c) => {
  const roomId = c.req.param('roomId')

  const room = db.select().from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return c.json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404)

  const members = db
    .select({
      userId: roomMembers.userId,
      membership: roomMembers.membership,
    })
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId))
    .all()

  return c.json({ room, members })
})

// GET /api/devices — List devices
adminRoute.get('/api/devices', (c) => {
  const userId = c.req.query('userId')

  const where = userId ? eq(devices.userId, userId) : undefined
  const rows = db.select().from(devices).where(where).all()

  return c.json({ devices: rows })
})

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

// GET /api/tokens — List tokens
adminRoute.get('/api/tokens', (c) => {
  const oauthRows = db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.type, 'AccessToken'))
    .all()

  const userTokenRows = db.select().from(accountTokens).all()

  return c.json({ oauth_tokens: oauthRows, user_tokens: userTokenRows })
})

// DELETE /api/tokens/:tokenId — Delete token
adminRoute.delete('/api/tokens/:tokenId', (c) => {
  const tokenId = c.req.param('tokenId')

  // Try both — delete is idempotent
  db.delete(oauthTokens).where(eq(oauthTokens.id, tokenId)).run()
  db.delete(accountTokens).where(eq(accountTokens.token, tokenId)).run()

  const { adminUserId, ip } = getAdminContext(c)
  logAdminAction(adminUserId, 'token.revoke', 'token', tokenId, null, ip)

  return c.json({})
})

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
