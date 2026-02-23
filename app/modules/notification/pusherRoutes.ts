import type { AuthEnv } from '@/shared/middleware/auth'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { pushGatewayUrl } from '@/config'
import { db } from '@/db'
import { pushers } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'

const pusherSetSchema = z.object({
  kind: z.string(),
  app_id: z.string(),
  pushkey: z.string(),
  app_display_name: z.string().optional(),
  device_display_name: z.string().optional(),
  profile_tag: z.string().optional(),
  lang: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  append: z.boolean().optional().default(false),
})

export const pusherRoute = new Hono<AuthEnv>()
pusherRoute.use('/*', authMiddleware)

// GET /_matrix/client/v3/pushers
pusherRoute.get('/', (c) => {
  const auth = c.get('auth')

  const rows = db.select().from(pushers).where(eq(pushers.userId, auth.userId)).all()

  return c.json({
    pushers: rows.map(r => ({
      pushkey: r.pushkey,
      kind: r.kind,
      app_id: r.appId,
      app_display_name: r.appDisplayName,
      device_display_name: r.deviceDisplayName,
      profile_tag: r.profileTag,
      lang: r.lang,
      data: r.data,
    })),
  })
})

// POST /_matrix/client/v3/pushers/set
pusherRoute.post('/set', async (c) => {
  const auth = c.get('auth')
  const body = await c.req.json()
  const parsed = pusherSetSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ errcode: 'M_BAD_JSON', error: 'Invalid pusher data' }, 400)
  }

  const data = parsed.data

  // For HTTP pushers: fill in server default gateway if client omits data.url
  if (data.kind === 'http') {
    const clientUrl = data.data?.url
    if (!clientUrl && pushGatewayUrl) {
      data.data = { ...data.data, url: pushGatewayUrl }
    }
    const url = data.data?.url
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      return c.json({ errcode: 'M_BAD_JSON', error: 'HTTP pushers require data.url with https:// scheme (or configure IM_PUSH_GATEWAY_URL on server)' }, 400)
    }
  }

  // kind "" means delete
  if (data.kind === '') {
    db.delete(pushers)
      .where(and(
        eq(pushers.userId, auth.userId),
        eq(pushers.appId, data.app_id),
        eq(pushers.pushkey, data.pushkey),
      ))
      .run()
    return c.json({})
  }

  if (!data.append) {
    // Upsert: delete existing with same app_id + pushkey, then insert
    db.delete(pushers)
      .where(and(
        eq(pushers.userId, auth.userId),
        eq(pushers.appId, data.app_id),
        eq(pushers.pushkey, data.pushkey),
      ))
      .run()
  }

  db.insert(pushers).values({
    userId: auth.userId,
    deviceId: auth.deviceId ?? null,
    kind: data.kind,
    appId: data.app_id,
    pushkey: data.pushkey,
    appDisplayName: data.app_display_name ?? null,
    deviceDisplayName: data.device_display_name ?? null,
    profileTag: data.profile_tag ?? null,
    lang: data.lang ?? null,
    data: data.data,
  }).run()

  return c.json({})
})
