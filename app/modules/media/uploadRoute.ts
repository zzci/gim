import type { AuthEnv } from '@/shared/middleware/auth'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { mediaQuotaMb, mediaUploadsPerHour, serverName } from '@/config'
import { db } from '@/db'
import { media } from '@/db/schema'
import {
  checkUploadRateLimit,
  generateMediaId,
  MAX_UPLOAD_SIZE,
  reserveMediaRecord,
  sanitizeUploadFileName,
  storagePathForMediaId,
} from '@/modules/media/mediaHelpers'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixNotFound } from '@/shared/middleware/errors'
import { headS3Object, isS3Enabled, uploadToS3 } from '@/utils/s3'

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

  const mediaId = generateMediaId()
  const storagePath = storagePathForMediaId(mediaId, isS3Enabled())

  // Atomic quota check + record insert in one transaction
  if (!reserveMediaRecord({ id: mediaId, userId: auth.userId, contentType, fileName, fileSize: body.byteLength, storagePath }))
    return matrixError(c, 'M_TOO_LARGE', `Storage quota exceeded (${mediaQuotaMb}MB)`)

  // Upload file after quota is reserved
  try {
    if (isS3Enabled()) {
      await uploadToS3(mediaId, body, contentType)
    }
    else {
      await Bun.write(storagePath, body)
    }
  }
  catch (e) {
    // Upload failed — release reserved quota by deleting the record
    db.delete(media).where(eq(media.id, mediaId)).run()
    throw e
  }

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

    if (!reserveMediaRecord({ id: mediaId, userId: auth.userId, contentType: head.contentType, fileName, fileSize: head.size, storagePath: `s3:${mediaId}` }, true))
      return matrixError(c, 'M_TOO_LARGE', `Storage quota exceeded (${mediaQuotaMb}MB)`)

    return c.json({})
  }

  if (body.byteLength > MAX_UPLOAD_SIZE) {
    return matrixError(c, 'M_TOO_LARGE', 'Upload exceeds maximum size')
  }

  const storagePath = storagePathForMediaId(mediaId, isS3Enabled())

  // Atomic quota check + record insert
  if (!reserveMediaRecord({ id: mediaId, userId: auth.userId, contentType, fileName, fileSize: body.byteLength, storagePath }, true))
    return matrixError(c, 'M_TOO_LARGE', `Storage quota exceeded (${mediaQuotaMb}MB)`)

  // Upload file after quota is reserved
  try {
    if (isS3Enabled()) {
      await uploadToS3(mediaId, body, contentType)
    }
    else {
      await Bun.write(storagePath, body)
    }
  }
  catch (e) {
    db.delete(media).where(eq(media.id, mediaId)).run()
    throw e
  }

  return c.json({})
})
