import { and, count, desc, eq, gte, like, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { serverName } from '@/config'
import { db } from '@/db'
import { accounts, accountTokens, adminAuditLog, currentRoomState, devices, e2eeDeviceKeys, e2eeFallbackKeys, e2eeOneTimeKeys, e2eeToDeviceMessages, eventsState, eventsTimeline, media, mediaDeletions, oauthTokens, roomMembers, rooms } from '@/db/schema'
import { createEvent } from '@/modules/message/service'
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

// GET /api/rooms/:roomId/state — Room state viewer
adminRoute.get('/api/rooms/:roomId/state', (c) => {
  const roomId = c.req.param('roomId')

  const room = db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return c.json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404)

  const stateRows = db
    .select({
      eventId: currentRoomState.eventId,
      type: currentRoomState.type,
      stateKey: currentRoomState.stateKey,
    })
    .from(currentRoomState)
    .where(eq(currentRoomState.roomId, roomId))
    .all()

  if (stateRows.length === 0)
    return c.json([])

  const result: Array<Record<string, unknown>> = []
  for (const row of stateRows) {
    const event = db.select().from(eventsState).where(eq(eventsState.id, row.eventId)).get()
    if (event) {
      result.push({
        type: event.type,
        state_key: event.stateKey,
        sender: event.sender,
        content: event.content,
        event_id: `$${event.id}`,
        origin_server_ts: event.originServerTs,
      })
    }
  }

  return c.json(result)
})

// PUT /api/rooms/:roomId/state/:eventType/:stateKey — Room state editor
adminRoute.put('/api/rooms/:roomId/state/:eventType/:stateKey', async (c) => {
  const roomId = c.req.param('roomId')
  const eventType = c.req.param('eventType')
  const stateKey = c.req.param('stateKey') ?? ''

  const room = db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).get()
  if (!room)
    return c.json({ errcode: 'M_NOT_FOUND', error: 'Room not found' }, 404)

  const { adminUserId, ip } = getAdminContext(c)
  const body = await c.req.json<{ content: Record<string, unknown> }>()

  const event = createEvent({
    roomId,
    sender: adminUserId,
    type: eventType,
    stateKey,
    content: body.content,
  })

  logAdminAction(adminUserId, 'room.set_state', 'room', roomId, { eventType, stateKey }, ip)

  return c.json({ event_id: event.event_id })
})

// DELETE /api/devices/:userId/:deviceId — Delete device and all associated data
adminRoute.delete('/api/devices/:userId/:deviceId', (c) => {
  const userId = c.req.param('userId')
  const deviceId = c.req.param('deviceId')

  db.delete(devices).where(and(eq(devices.userId, userId), eq(devices.id, deviceId))).run()
  db.delete(e2eeDeviceKeys).where(and(eq(e2eeDeviceKeys.userId, userId), eq(e2eeDeviceKeys.deviceId, deviceId))).run()
  db.delete(e2eeOneTimeKeys).where(and(eq(e2eeOneTimeKeys.userId, userId), eq(e2eeOneTimeKeys.deviceId, deviceId))).run()
  db.delete(e2eeFallbackKeys).where(and(eq(e2eeFallbackKeys.userId, userId), eq(e2eeFallbackKeys.deviceId, deviceId))).run()
  db.delete(oauthTokens).where(eq(oauthTokens.deviceId, deviceId)).run()
  db.delete(e2eeToDeviceMessages).where(and(eq(e2eeToDeviceMessages.userId, userId), eq(e2eeToDeviceMessages.deviceId, deviceId))).run()

  const { adminUserId, ip } = getAdminContext(c)
  logAdminAction(adminUserId, 'device.delete', 'device', `${userId}/${deviceId}`, null, ip)

  return c.json({ success: true })
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
