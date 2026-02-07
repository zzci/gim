import { Hono } from 'hono'
import { serverName } from '@/config'

export const appRoute = new Hono()

const config = {
  default_server_config: {
    'm.homeserver': {
      base_url: 'https://' + serverName,
    },
  },
  disable_3pid_login: false,
  disable_guests: true,
  branding: {
    auth_footer_links: [],
  },
  embedded_pages: {
    login_for_welcome: true,
  },
  oidc_metadata: {
    client_uri: 'https://' + serverName + '/app',
  },
  UIFeature: {
    'identityServer': false,
  }
}

appRoute.get('/*', async (c) => {
  if (c.req.path.startsWith('/config')) {
    return c.json(config)
  }
  if (c.req.path.startsWith('/version')) {
    return c.text('v1.11.101')
  }

  try {
    const pathWithoutApp = c.req.path.replace(/^\/app/, '')
    const extension = pathWithoutApp.split('.').pop()?.toLowerCase()
    let contentType = 'application/octet-stream'
    switch (extension) {
      case 'js':
        contentType = 'application/javascript'
        break
      case 'css':
        contentType = 'text/css'
        break
      case 'json':
        contentType = 'application/json'
        break
      case 'png':
        contentType = 'image/png'
        break
      case 'jpg':
      case 'jpeg':
        contentType = 'image/jpeg'
        break
      case 'gif':
        contentType = 'image/gif'
        break
      case 'svg':
        contentType = 'image/svg+xml'
        break
      case 'ico':
        contentType = 'image/x-icon'
        break
      case 'woff':
        contentType = 'font/woff'
        break
      case 'woff2':
        contentType = 'font/woff2'
        break
    }
    const url = new URL('https://matrix-web.g.im/element-v1.11.101' + pathWithoutApp)
    const response = await fetch(url)

    const res = new Response(response.body)
    res.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.headers.set('Content-Type', contentType)
    return res
  } catch (error) {
    c.text('Internal Server Error', 500)
  }
})
