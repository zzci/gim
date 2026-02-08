import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { listenHost, listenPort } from './config'
import { account, auth, e2ee, deviceRoute, mediaUploadRoute, mediaCreateRoute, mediaDownloadRoute, mediaThumbnailRoute, mediaConfigRoute, mediaPreviewRoute, room, server, testRoute, appRoute, emptyRoute } from './routes'
import { rateLimitMiddleware } from '@/middleware/rateLimit'
import { closeRedis } from '@/redis'
import '@/global'
import '@/db'
import { sqlite } from '@/db'
import { logger as accesslog } from 'hono/logger'

export const customLogger = (message: string, ...rest: string[]) => {
  if (message.includes('matrix')) {
    logger.info(message, ...rest)
  }
}

async function run() {
  const app = new Hono()

  // CORS — Matrix clients send cross-origin requests
  app.use('/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'Content-Type'],
    maxAge: 86400,
  }))

  // Rate limiting on Matrix API
  app.use('/_matrix/*', rateLimitMiddleware)

  app.use(accesslog(customLogger))

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }))

  /* test */
  app.route('/test', testRoute)

  /* server */
  app.route('/', server.homeRoute)
  app.route('/api', server.apiRoute)

  // matrix server info
  app.route('/.well-known/matrix/client', server.wellKnowClientRoute)
  app.route('/.well-known/matrix/server', server.wellKnowServerRoute)
  app.route('/_matrix/client/versions', server.versionsRoute)
  app.route('/_matrix/client/v3/capabilities', server.capabilitiesRoute)

  /* oauth */
  app.route('/_matrix/client/v1/auth_metadata', auth.metadataRoute)
  app.route('/_matrix/client/unstable/org.matrix.msc2965/auth_metadata', auth.metadataRoute)
  app.route('/_matrix/gim/oauth2/registration', auth.oauth2RegistrationRoute)

  /* auth */
  app.route('/_matrix/client/v3/register', auth.registerRoute)
  app.route('/_matrix/client/v3/login', auth.loginRoute)
  app.route('/_matrix/client/v3/logout', auth.logoutRoute)
  app.route('/_matrix/client/v3/refresh', auth.refreshRoute)

  app.route('/_matrix/client/v3/account/whoami', account.whoamiRoute)

  // account info
  app.route('/_matrix/client/v3/user/:id/account_data', account.accountDataRoute)
  app.route('/_matrix/client/v3/user/:id/filter', account.userFilterRoute)
  app.route('/_matrix/client/v3/profile', account.profileRoute)

  // push rules
  app.route('/_matrix/client/v3/pushrules/', account.pushRulesRoute)

  /* room */
  app.route('/_matrix/client/v3/createRoom', room.createRoomRoute)
  app.route('/_matrix/client/v3/join', room.joinRoute)
  app.route('/_matrix/client/v3/joined_rooms', room.joinedRoomsRoute)
  app.route('/_matrix/client/v3/rooms', room.roomsRouter)
  app.route('/_matrix/client/v3/sync', room.syncRoute)

  /* e2ee */
  app.route('/_matrix/client/v3/room_keys/version', e2ee.roomKeysVersionRoute)
  app.route('/_matrix/client/v3/keys/query', e2ee.keysQueryRoute)
  app.route('/_matrix/client/v3/keys/upload', e2ee.keysUploadRoute)
  app.route('/_matrix/client/v3/keys/claim', e2ee.keysClaimRoute)
  app.route('/_matrix/client/v3/keys/changes', e2ee.keysChangesRoute)
  app.route('/_matrix/client/v3/keys/device_signing/upload', e2ee.crossSigningRoute)
  app.route('/_matrix/client/v3/keys/signatures/upload', e2ee.signaturesUploadRoute)
  app.route('/_matrix/client/v3/sendToDevice', e2ee.sendToDeviceRoute)

  /* devices */
  app.route('/_matrix/client/v3/devices', deviceRoute)

  /* media */
  // Content repository (authenticated upload)
  app.route('/_matrix/media/v3/upload', mediaUploadRoute)
  app.route('/_matrix/client/v1/media/upload', mediaUploadRoute)
  app.route('/_matrix/client/v1/media/create', mediaCreateRoute)
  // Content retrieval (download, thumbnail)
  app.route('/_matrix/client/v1/media/download', mediaDownloadRoute)
  app.route('/_matrix/client/v1/media/thumbnail', mediaThumbnailRoute)
  app.route('/_matrix/client/v1/media/config', mediaConfigRoute)
  app.route('/_matrix/client/v1/media/preview_url', mediaPreviewRoute)

  // empty route
  app.route('/_matrix/client/v3/thirdparty/protocols', emptyRoute)
  app.route('/_matrix/client/v3/voip/turnServer', emptyRoute)

  // Static files
  app.get('/public/*', serveStatic({ root: './' }))

  // web client
  app.get('/app', serveStatic({ path: './third/element/app.html' }))
  app.route('/version', appRoute)
  app.route('/config*', appRoute)
  app.route('/i18n/*', appRoute)
  app.route('/app/*', appRoute)
  app.route('/themes/*', appRoute)
  app.route('/icons/*', appRoute)
  app.route('/sw.js', appRoute)
  app.route('/welcome*', appRoute)

  const http = Bun.serve({
    fetch: app.fetch,
    port: listenPort,
    hostname: listenHost,
  })

  logger.info(`Running at http://${listenHost}:${listenPort}`)

  async function shutdown(signal: string) {
    logger.warn(`Received ${signal}. Shutting down...`)
    http.stop()
    await closeRedis()
    sqlite.close()
    logger.info('Shutdown complete.')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

run().catch((e) => {
  logger.error(e)
  process.exit(1)
})
