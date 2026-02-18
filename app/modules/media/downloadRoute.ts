import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { serverName } from '@/config'
import { db } from '@/db'
import { media } from '@/db/schema'
import { isS3Path, s3KeyFromPath, sanitizeFileName } from '@/modules/media/mediaHelpers'
import { matrixNotFound } from '@/shared/middleware/errors'
import { getDownloadUrl } from '@/utils/s3'

// ---- Download ----
export const mediaDownloadRoute = new Hono()

// GET /_matrix/client/v1/media/download/:serverName/:mediaId
// GET /_matrix/client/v1/media/download/:serverName/:mediaId/:fileName
mediaDownloadRoute.get('/:server/:mediaId', handleDownload)
mediaDownloadRoute.get('/:server/:mediaId/:fileName', handleDownload)

async function handleDownload(c: any) {
  const mediaId = c.req.param('mediaId')
  const requestedServer = c.req.param('server')

  // Only serve local media
  if (requestedServer !== serverName) {
    return matrixNotFound(c, 'Media not found on this server')
  }

  const record = db.select().from(media).where(eq(media.id, mediaId)).get()

  if (!record) {
    return matrixNotFound(c, 'Media not found')
  }

  // S3 storage: redirect to download URL
  if (isS3Path(record.storagePath)) {
    const url = await getDownloadUrl(s3KeyFromPath(record.storagePath))
    return c.redirect(url, 302)
  }

  // Local storage
  const file = Bun.file(record.storagePath)
  if (!await file.exists()) {
    return matrixNotFound(c, 'Media file missing')
  }

  const headers: Record<string, string> = {
    'Content-Type': record.contentType,
    'Content-Length': String(record.fileSize),
    'Cache-Control': 'public, max-age=86400, immutable',
  }

  if (record.fileName) {
    const safe = sanitizeFileName(record.fileName)
    headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(safe)}`
  }

  return new Response(file.stream(), { headers })
}
