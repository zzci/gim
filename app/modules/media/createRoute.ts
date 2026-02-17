import type { AuthEnv } from '@/shared/middleware/auth'
import { Hono } from 'hono'
import { serverName } from '@/config'
import { generateMediaId } from '@/modules/media/mediaHelpers'
import { authMiddleware } from '@/shared/middleware/auth'
import { getPresignedUploadUrl, isS3Enabled } from '@/utils/s3'

// POST /_matrix/media/v1/create - create mxc URI for async upload
export const mediaCreateRoute = new Hono<AuthEnv>()
mediaCreateRoute.use('/*', authMiddleware)

mediaCreateRoute.post('/', async (c) => {
  const mediaId = generateMediaId()

  const response: Record<string, unknown> = {
    content_uri: `mxc://${serverName}/${mediaId}`,
    unused_expires_at: Date.now() + 24 * 60 * 60 * 1000,
  }

  if (isS3Enabled()) {
    response.upload_url = await getPresignedUploadUrl(mediaId, 'application/octet-stream')
  }

  return c.json(response)
})
