import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { media } from '@/db/schema'
import { serverName } from '@/config'
import { authMiddleware, type AuthContext } from '@/middleware/auth'
import { matrixNotFound, matrixError } from '@/middleware/errors'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const MEDIA_DIR = 'data/media'
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50 MB

// Ensure media directory exists
await mkdir(MEDIA_DIR, { recursive: true })

function generateMediaId(): string {
  return randomBytes(16).toString('base64url')
}

// ---- Upload (v3 and v1) ----
export const mediaUploadRoute = new Hono()
mediaUploadRoute.use('/*', authMiddleware)

// POST /_matrix/media/v3/upload (or /v1/media/upload)
mediaUploadRoute.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext
  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const fileName = c.req.query('filename') || null

  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_UPLOAD_SIZE) {
    return matrixError(c, 'M_TOO_LARGE', 'Upload exceeds maximum size')
  }

  const mediaId = generateMediaId()
  const storagePath = join(MEDIA_DIR, mediaId)

  await Bun.write(storagePath, body)

  db.insert(media).values({
    id: mediaId,
    userId: auth.userId,
    contentType,
    fileName,
    fileSize: body.byteLength,
    storagePath,
  }).run()

  return c.json({
    content_uri: `mxc://${serverName}/${mediaId}`,
  })
})

// PUT /_matrix/media/v3/upload/:serverName/:mediaId (async upload)
mediaUploadRoute.put('/:server/:mediaId', async (c) => {
  const auth = c.get('auth') as AuthContext
  const mediaId = c.req.param('mediaId')
  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const fileName = c.req.query('filename') || null

  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_UPLOAD_SIZE) {
    return matrixError(c, 'M_TOO_LARGE', 'Upload exceeds maximum size')
  }

  const storagePath = join(MEDIA_DIR, mediaId)
  await Bun.write(storagePath, body)

  db.insert(media).values({
    id: mediaId,
    userId: auth.userId,
    contentType,
    fileName,
    fileSize: body.byteLength,
    storagePath,
  }).onConflictDoUpdate({
    target: media.id,
    set: { contentType, fileName, fileSize: body.byteLength, storagePath },
  }).run()

  return c.json({})
})

// POST /_matrix/media/v1/create - create mxc URI for async upload
export const mediaCreateRoute = new Hono()
mediaCreateRoute.use('/*', authMiddleware)

mediaCreateRoute.post('/', async (c) => {
  const mediaId = generateMediaId()

  return c.json({
    content_uri: `mxc://${serverName}/${mediaId}`,
    unused_expires_at: Date.now() + 24 * 60 * 60 * 1000,
  })
})

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

  const record = db.select().from(media)
    .where(eq(media.id, mediaId))
    .get()

  if (!record) {
    return matrixNotFound(c, 'Media not found')
  }

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
    headers['Content-Disposition'] = `inline; filename="${record.fileName}"`
  }

  return new Response(file.stream(), { headers })
}

// ---- Thumbnail ----
export const mediaThumbnailRoute = new Hono()

// GET /_matrix/client/v1/media/thumbnail/:serverName/:mediaId
mediaThumbnailRoute.get('/:server/:mediaId', async (c) => {
  const mediaId = c.req.param('mediaId')
  const requestedServer = c.req.param('server')

  if (requestedServer !== serverName) {
    return matrixNotFound(c, 'Media not found on this server')
  }

  const record = db.select().from(media)
    .where(eq(media.id, mediaId))
    .get()

  if (!record) {
    return matrixNotFound(c, 'Media not found')
  }

  // For now, return the original file as thumbnail
  // Full implementation would resize images
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

// ---- Config ----
export const mediaConfigRoute = new Hono()

// GET /_matrix/client/v1/media/config
mediaConfigRoute.use('/*', authMiddleware)
mediaConfigRoute.get('/', (c) => {
  return c.json({
    'm.upload.size': MAX_UPLOAD_SIZE,
  })
})

// ---- Preview URL ----
export const mediaPreviewRoute = new Hono()
mediaPreviewRoute.use('/*', authMiddleware)

mediaPreviewRoute.get('/', (c) => {
  // URL preview - stub returning empty
  return c.json({})
})
