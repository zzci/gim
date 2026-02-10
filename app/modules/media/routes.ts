import type { AuthEnv } from '@/shared/middleware/auth'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { mediaQuotaMb, mediaUploadsPerHour, serverName } from '@/config'
import { db } from '@/db'
import { media } from '@/db/schema'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixNotFound } from '@/shared/middleware/errors'
import { getDownloadUrl, getPresignedUploadUrl, headS3Object, isS3Enabled, uploadToS3 } from '@/utils/s3'

const MEDIA_DIR = 'data/media'
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50 MB

// Ensure local media directory exists (even in S3 mode, for backward compat)
mkdirSync(MEDIA_DIR, { recursive: true })

function generateMediaId(): string {
  return randomBytes(16).toString('base64url')
}

function sanitizeFileName(name: string): string {
  return name.replace(/["\\\n\r]/g, '_')
}

function sanitizeUploadFileName(name: string): string | null {
  let sanitized = name
  sanitized = sanitized.replace(/\0/g, '')
  sanitized = sanitized.replace(/[/\\]/g, '_')
  sanitized = sanitized.replace(/^\.+/, '')
  sanitized = sanitized.slice(0, 255)
  return sanitized || null
}

// Per-user upload rate limiter
const uploadWindows = new Map<string, { count: number, resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of uploadWindows) {
    if (now > val.resetAt)
      uploadWindows.delete(key)
  }
}, 5 * 60_000)

function checkUploadRateLimit(userId: string): boolean {
  if (mediaUploadsPerHour <= 0)
    return true

  const now = Date.now()
  const entry = uploadWindows.get(userId)

  if (!entry || now > entry.resetAt) {
    uploadWindows.set(userId, { count: 1, resetAt: now + 3600_000 })
    return true
  }

  entry.count++
  return entry.count <= mediaUploadsPerHour
}

function checkStorageQuota(userId: string, uploadSize: number): boolean {
  if (mediaQuotaMb <= 0)
    return true

  const row = db.select({ total: sql<number>`coalesce(sum(${media.fileSize}), 0)` })
    .from(media)
    .where(eq(media.userId, userId))
    .get()

  const used = row?.total || 0
  return (used + uploadSize) <= mediaQuotaMb * 1024 * 1024
}

function isS3Path(storagePath: string): boolean {
  return storagePath.startsWith('s3:')
}

function s3KeyFromPath(storagePath: string): string {
  return storagePath.slice(3)
}

// ---- Upload (v3 and v1) ----
export const mediaUploadRoute = new Hono<AuthEnv>()
mediaUploadRoute.use('/*', authMiddleware)

// POST /_matrix/media/v3/upload (or /v1/media/upload)
mediaUploadRoute.post('/', async (c) => {
  const auth = c.get('auth')
  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const rawFileName = c.req.query('filename') || null
  const fileName = rawFileName ? sanitizeUploadFileName(rawFileName) : null

  if (!checkUploadRateLimit(auth.userId))
    return matrixError(c, 'M_LIMIT_EXCEEDED', `Upload rate limit exceeded (${mediaUploadsPerHour}/hour)`, { retry_after_ms: 60000 })

  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_UPLOAD_SIZE) {
    return matrixError(c, 'M_TOO_LARGE', 'Upload exceeds maximum size')
  }

  if (!checkStorageQuota(auth.userId, body.byteLength))
    return matrixError(c, 'M_TOO_LARGE', `Storage quota exceeded (${mediaQuotaMb}MB)`)

  const mediaId = generateMediaId()
  let storagePath: string

  if (isS3Enabled()) {
    await uploadToS3(mediaId, body, contentType)
    storagePath = `s3:${mediaId}`
  }
  else {
    storagePath = join(MEDIA_DIR, mediaId)
    await Bun.write(storagePath, body)
  }

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
  const auth = c.get('auth')
  const mediaId = c.req.param('mediaId')
  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const rawFileName = c.req.query('filename') || null
  const fileName = rawFileName ? sanitizeUploadFileName(rawFileName) : null

  if (!checkUploadRateLimit(auth.userId))
    return matrixError(c, 'M_LIMIT_EXCEEDED', `Upload rate limit exceeded (${mediaUploadsPerHour}/hour)`, { retry_after_ms: 60000 })

  const body = await c.req.arrayBuffer()
  if (body.byteLength === 0 && isS3Enabled()) {
    // Presigned upload confirmation: client uploaded directly to S3
    const head = await headS3Object(mediaId)
    if (!head)
      return matrixNotFound(c, 'Media file not found in storage')

    if (!checkStorageQuota(auth.userId, head.size))
      return matrixError(c, 'M_TOO_LARGE', `Storage quota exceeded (${mediaQuotaMb}MB)`)

    db.insert(media).values({
      id: mediaId,
      userId: auth.userId,
      contentType: head.contentType,
      fileName,
      fileSize: head.size,
      storagePath: `s3:${mediaId}`,
    }).onConflictDoUpdate({
      target: media.id,
      set: { contentType: head.contentType, fileName, fileSize: head.size, storagePath: `s3:${mediaId}` },
    }).run()

    return c.json({})
  }

  if (body.byteLength > MAX_UPLOAD_SIZE) {
    return matrixError(c, 'M_TOO_LARGE', 'Upload exceeds maximum size')
  }

  if (!checkStorageQuota(auth.userId, body.byteLength))
    return matrixError(c, 'M_TOO_LARGE', `Storage quota exceeded (${mediaQuotaMb}MB)`)

  let storagePath: string

  if (isS3Enabled()) {
    await uploadToS3(mediaId, body, contentType)
    storagePath = `s3:${mediaId}`
  }
  else {
    storagePath = join(MEDIA_DIR, mediaId)
    await Bun.write(storagePath, body)
  }

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
    headers['Content-Disposition'] = `inline; filename="${sanitizeFileName(record.fileName)}"`
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
