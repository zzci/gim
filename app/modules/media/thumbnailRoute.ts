import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { serverName } from '@/config'
import { db } from '@/db'
import { media } from '@/db/schema'
import { isS3Path, s3KeyFromPath } from '@/modules/media/mediaHelpers'
import { matrixNotFound } from '@/shared/middleware/errors'
import { getDownloadUrl } from '@/utils/s3'

// ---- Thumbnail ----
export const mediaThumbnailRoute = new Hono()

// GET /_matrix/client/v1/media/thumbnail/:serverName/:mediaId
mediaThumbnailRoute.get('/:server/:mediaId', async (c) => {
  const mediaId = c.req.param('mediaId')
  const requestedServer = c.req.param('server')

  if (requestedServer !== serverName) {
    return matrixNotFound(c, 'Media not found on this server')
  }

  const record = db.select().from(media).where(eq(media.id, mediaId)).get()

  if (!record) {
    return matrixNotFound(c, 'Media not found')
  }

  // S3 storage: redirect to download URL (same as full file for E2EE)
  if (isS3Path(record.storagePath)) {
    const url = await getDownloadUrl(s3KeyFromPath(record.storagePath))
    return c.redirect(url, 302)
  }

  // Local storage: return original file as thumbnail
  const file = Bun.file(record.storagePath)
  if (!await file.exists()) {
    return matrixNotFound(c, 'Media file missing')
  }

  return new Response(file.stream(), {
    headers: {
      'Content-Type': record.contentType,
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
})
