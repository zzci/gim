import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { inspectRoutes } from 'hono/dev'
import { closeCache } from '@/cache'
import { startCron } from '@/cron'
import { sqlite } from '@/db'
import { accountDataRoute, accountTokensRoute, deactivateRoute, profileRoute, pushRulesRoute, userFilterRoute, whoamiRoute } from '@/modules/account'
import { flushAccountTokenLastUsedAt } from '@/modules/account/tokenCache'
import { adminRoute } from '@/modules/admin'
import { appServicePingRoute } from '@/modules/appservice'
import { loadAppServiceRegistrations } from '@/modules/appservice/config'
import { loginRoute, logoutRoute, metadataRoute, refreshRoute, registerRoute, ssoCallbackRoute, ssoRedirectRoute } from '@/modules/auth'

import { deviceRoute } from '@/modules/device'
import { crossSigningRoute, dehydratedDeviceRoute, keysChangesRoute, keysClaimRoute, keysQueryRoute, keysUploadRoute, roomKeysRoute, sendToDeviceRoute, signaturesUploadRoute } from '@/modules/e2ee'
import { mediaConfigRoute, mediaCreateRoute, mediaDownloadRoute, mediaPreviewRoute, mediaThumbnailRoute, mediaUploadRoute } from '@/modules/media'
import { messageRouter } from '@/modules/message'
import { notificationsRoute } from '@/modules/notification'
import { pusherRoute } from '@/modules/notification/pusherRoutes'
import { presenceRoute } from '@/modules/presence'
import { createRoomRoute, directoryListRoute, joinedRoomsRoute, joinRoute, publicRoomsRoute, roomAliasRoute, roomMembershipRouter, roomSummaryRoute } from '@/modules/room'
// Module imports
import { capabilitiesRoute, versionsRoute, wellKnowClientRoute, wellKnowServerRoute } from '@/modules/server'
import { syncRoute } from '@/modules/sync'
import { slidingSyncRoute } from '@/modules/sync/slidingRoutes'
import { threadRoute } from '@/modules/thread'
import { rtcTransportsRoute, turnServerRoute } from '@/modules/voip'
import { oauthApp } from '@/oauth/provider'
import { formatPrometheusMetrics } from '@/shared/metrics'
import { rateLimitMiddleware } from '@/shared/middleware/rateLimit'
import { requestIdMiddleware } from '@/shared/middleware/requestId'
import { requestLogMiddleware } from '@/shared/middleware/requestLog'
import { buildInfo, corsOrigins, listenHost, listenPort, serverName, version } from './config'

import '@/global'

async function run() {
  const app = new Hono({ strict: false })

  // 1. Request ID (first — everything depends on this)
  app.use('/*', requestIdMiddleware)

  // 2. CORS — Matrix clients send cross-origin requests
  const origin = corsOrigins === '*' ? '*' : corsOrigins.includes(',') ? corsOrigins.split(',').map(s => s.trim()) : corsOrigins
  app.use('/*', cors({
    origin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'Content-Type', 'X-Request-Id'],
    maxAge: 86400,
  }))

  // 3. Structured request logging (after next — captures status/duration)
  app.use('/*', requestLogMiddleware)

  // Rate limiting on Matrix API + OAuth
  app.use('/_matrix/*', rateLimitMiddleware)

  // Root — server info + supported API list (registered lazily after all routes mount)

  // Health checks
  app.get('/health', c => c.redirect('/health/live'))
  app.get('/health/live', c => c.json({ status: 'ok' }))
  app.get('/health/ready', (c) => {
    try {
      sqlite.exec('SELECT 1')
      return c.json({
        status: 'ok',
        version,
        uptime_seconds: Math.floor(process.uptime()),
        db: 'connected',
      })
    }
    catch {
      return c.json({
        status: 'error',
        version,
        uptime_seconds: Math.floor(process.uptime()),
        db: 'disconnected',
      }, 503)
    }
  })

  // Metrics — Prometheus text format
  app.get('/metrics', (c) => {
    return c.text(formatPrometheusMetrics(), 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    })
  })

  // Self-contained OIDC provider
  app.use('/oauth/*', rateLimitMiddleware)
  app.route('/oauth', oauthApp)

  // matrix server info
  app.route('/.well-known/matrix/client', wellKnowClientRoute)
  app.route('/.well-known/matrix/server', wellKnowServerRoute)
  app.route('/_matrix/client/versions', versionsRoute)
  app.route('/_matrix/client/v3/capabilities', capabilitiesRoute)

  /* oauth */
  app.route('/_matrix/client/v1/auth_metadata', metadataRoute)
  app.route('/_matrix/client/unstable/org.matrix.msc2965/auth_metadata', metadataRoute)

  /* auth */
  app.route('/_matrix/client/v3/register', registerRoute)
  app.route('/_matrix/client/v3/login', loginRoute)
  app.route('/_matrix/client/v3/login/sso/redirect', ssoRedirectRoute)
  app.route('/_matrix/client/v3/login/sso/callback', ssoCallbackRoute)
  app.route('/_matrix/client/v3/logout', logoutRoute)
  app.route('/_matrix/client/v3/refresh', refreshRoute)

  app.route('/_matrix/client/v3/account/whoami', whoamiRoute)
  app.route('/_matrix/client/v3/account/deactivate', deactivateRoute)

  // account info
  app.route('/_matrix/client/v3/user/:id/account_data', accountDataRoute)
  app.route('/_matrix/client/v3/user/:id/filter', userFilterRoute)
  app.route('/_matrix/client/v3/profile', profileRoute)

  // push rules
  app.route('/_matrix/client/v3/pushrules/', pushRulesRoute)

  // user tokens (long-lived bot tokens)
  app.route('/_matrix/client/v3/user_tokens', accountTokensRoute)

  /* room */
  app.route('/_matrix/client/v3/createRoom', createRoomRoute)
  app.route('/_matrix/client/v3/join', joinRoute)
  app.route('/_matrix/client/v3/joined_rooms', joinedRoomsRoute)
  app.route('/_matrix/client/v3/directory/room', roomAliasRoute)
  app.route('/_matrix/client/v3/directory/list/room', directoryListRoute)
  app.route('/_matrix/client/v3/publicRooms', publicRoomsRoute)
  app.route('/_matrix/client/unstable/im.nheko.summary/rooms', roomSummaryRoute)
  app.route('/_matrix/client/v1/summary/rooms', roomSummaryRoute)
  app.route('/_matrix/client/v3/rooms', roomMembershipRouter)
  app.route('/_matrix/client/v3/rooms', messageRouter)
  app.route('/_matrix/client/v1/rooms', threadRoute)
  app.route('/_matrix/client/v3/notifications', notificationsRoute)
  app.route('/_matrix/client/v3/pushers', pusherRoute)
  app.route('/_matrix/client/v3/sync', syncRoute)
  app.route('/_matrix/client/unstable/org.matrix.simplified_msc3575', slidingSyncRoute)

  /* presence */
  app.route('/_matrix/client/v3/presence', presenceRoute)

  /* voip */
  app.route('/_matrix/client/v3/voip/turnServer', turnServerRoute)
  app.route('/_matrix/client/v1/rtc/transports', rtcTransportsRoute)

  /* e2ee */
  app.route('/_matrix/client/v3/keys/query', keysQueryRoute)
  app.route('/_matrix/client/v3/keys/upload', keysUploadRoute)
  app.route('/_matrix/client/v3/keys/claim', keysClaimRoute)
  app.route('/_matrix/client/v3/keys/changes', keysChangesRoute)
  app.route('/_matrix/client/v3/keys/device_signing/upload', crossSigningRoute)
  app.route('/_matrix/client/v3/keys/signatures/upload', signaturesUploadRoute)
  app.route('/_matrix/client/v3/sendToDevice', sendToDeviceRoute)
  app.route('/_matrix/client/v3/room_keys', roomKeysRoute)
  app.route('/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device', dehydratedDeviceRoute)

  /* devices */
  app.route('/_matrix/client/v3/devices', deviceRoute)

  /* media */
  // Content repository (authenticated upload)
  app.route('/_matrix/media/v3/upload', mediaUploadRoute)
  app.route('/_matrix/client/v1/media/upload', mediaUploadRoute)
  app.route('/_matrix/client/v1/media/create', mediaCreateRoute)
  // Content retrieval (download, thumbnail, config, preview)
  app.route('/_matrix/client/v1/media/download', mediaDownloadRoute)
  app.route('/_matrix/client/v1/media/thumbnail', mediaThumbnailRoute)
  app.route('/_matrix/client/v1/media/config', mediaConfigRoute)
  app.route('/_matrix/client/v1/media/preview_url', mediaPreviewRoute)
  // Legacy v3 media paths
  app.route('/_matrix/media/v3/download', mediaDownloadRoute)
  app.route('/_matrix/media/v3/thumbnail', mediaThumbnailRoute)
  app.route('/_matrix/media/v3/config', mediaConfigRoute)
  app.route('/_matrix/media/v3/preview_url', mediaPreviewRoute)

  /* appservice */
  app.route('/_matrix/client/v1/appservice', appServicePingRoute)

  /* admin */
  app.route('/admin', adminRoute)
  app.get('/admin/assets/*', serveStatic({ root: './admin/dist', rewriteRequestPath: p => p.replace('/admin', '') }))
  app.get('/admin/*', async (c) => {
    const file = Bun.file('./admin/dist/index.html')
    if (await file.exists()) {
      return c.html(await file.text())
    }
    return c.json({ error: 'Admin panel not built. Run: bun run admin:build' }, 404)
  })

  // Static files
  app.get('/public/*', serveStatic({ root: './' }))

  // Root — server info + auto-generated API list from registered routes
  const apis = inspectRoutes(app)
    .filter(r => !r.isMiddleware && r.method !== 'ALL')
    .reduce((acc, { method, path }) => {
      const existing = acc.get(path)
      if (existing)
        existing.add(method)
      else
        acc.set(path, new Set([method]))
      return acc
    }, new Map<string, Set<string>>())

  const apiList = [...apis.entries()].map(([path, methods]) => `${[...methods].join('/')} ${path}`)
  app.get('/', c => c.json({ server: 'gim', version, build: buildInfo, domain: serverName, apis: apiList }))

  // Catch-all for unmatched routes — return Matrix 404 with CORS headers
  app.notFound(c => c.json({ errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' }, 404))

  // Load Application Service registrations from DB + YAML
  loadAppServiceRegistrations()

  const stopCron = startCron()

  const http = Bun.serve({
    fetch: app.fetch,
    port: listenPort,
    hostname: listenHost,
    idleTimeout: 60, // must exceed sync long-poll timeout (28s) with margin for consecutive requests
  })

  logger.info('server_started', { host: listenHost, port: listenPort, serverName, version, ...buildInfo })

  async function shutdown(signal: string) {
    logger.warn('server_shutdown', { signal })
    stopCron()
    flushAccountTokenLastUsedAt()
    http.stop()
    await closeCache()
    sqlite.close()
    logger.info('server_stopped')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

run().catch((e) => {
  logger.error('startup_failed', { error: e instanceof Error ? e.message : e })
  process.exit(1)
})
