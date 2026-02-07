import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { listenHost, listenPort } from './config'
import { account, auth, e2ee, room, server, testRoute, appRoute, emptyRoute } from './routes'
import '@/global'
import { logger as accesslog } from 'hono/logger'

storage.set('server', {
  startTime: new Date(),
})

export const customLogger = (message: string, ...rest: string[]) => {
  if (message.includes('matrix')) {
    logger.info(message, ...rest)
  }
}

async function run() {
  const app = new Hono()

  app.use(accesslog(customLogger))

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

  /* account */
  app.route('/_matrix/client/v3/login', emptyRoute) // TODO: Implement login
  app.route('/_matrix/client/v3/logout', emptyRoute) // TODO: Implement logout
  app.route('/_matrix/client/v3/refresh', emptyRoute) // TODO: Implement register

  app.route('/_matrix/client/v3/account/whoami', account.whoamiRoute)

  // account info
  app.route('/_matrix/client/v3/user/:id/account_data', emptyRoute)
  app.route('/_matrix/client/v3/user/:id/filter', account.userFilterRoute)
  app.route('/_matrix/client/v3/user/:id/filter/*', emptyRoute)
  app.route('/_matrix/client/v3/profile/:id', emptyRoute)

  // push rules
  app.route('/_matrix/client/v3/pushrules/', account.pushRulesRoute)

  /* room */
  app.route('/_matrix/client/v3/sync', room.syncRoute)

  /* e2ee */
  app.route('/_matrix/client/v3/room_keys/version', e2ee.roomKeysVersionRoute)
  app.route('/_matrix/client/v3/keys/query', e2ee.keysQueryRoute)
  app.route('/_matrix/client/v3/keys/upload', e2ee.keysUploadRoute)

  // push

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

  process.on('SIGINT', () => {
    logger.warn('Received SIGINT. Shutting down...')
    http.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    logger.warn('Received SIGTERM. Shutting down...')
    http.stop()
    process.exit(0)
  })
}

run().catch((e) => {
  logger.error(e)
  process.exit(1)
})
