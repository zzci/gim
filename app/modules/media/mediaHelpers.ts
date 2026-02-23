import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { mediaQuotaMb, mediaUploadsPerHour } from '@/config'
import { db } from '@/db'
import { media } from '@/db/schema'

export const MEDIA_DIR = 'data/media'
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50 MB

// Ensure local media directory exists (even in S3 mode, for backward compat)
mkdirSync(MEDIA_DIR, { recursive: true })

export function generateMediaId(): string {
  return randomBytes(16).toString('base64url')
}

export function sanitizeFileName(name: string): string {
  return name.replace(/["\\\n\r]/g, '_')
}

export function sanitizeUploadFileName(name: string): string | null {
  let sanitized = name
  sanitized = sanitized.replace(/\0/g, '')
  sanitized = sanitized.replace(/[/\\]/g, '_')
  sanitized = sanitized.replace(/^\.+/, '')
  sanitized = sanitized.slice(0, 255)
  return sanitized || null
}

// Per-user upload rate limiter — intentionally kept in-memory for performance.
// Upload rate checks must be synchronous and fast; for multi-process deployments
// each process maintains its own window (acceptable since quota is enforced in DB).
const uploadWindows = new Map<string, { count: number, resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of uploadWindows) {
    if (now > val.resetAt)
      uploadWindows.delete(key)
  }
}, 5 * 60_000)

export function checkUploadRateLimit(userId: string): boolean {
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

class QuotaExceededError extends Error {}

/**
 * Atomically check quota and insert media record in a single transaction.
 * Eliminates the TOCTOU race condition where concurrent uploads could exceed quota.
 * Returns true if reservation succeeded, false if quota exceeded.
 */
export function reserveMediaRecord(values: {
  id: string
  userId: string
  contentType: string
  fileName: string | null
  fileSize: number
  storagePath: string
}, upsert = false): boolean {
  if (mediaQuotaMb <= 0) {
    // No quota limit — just insert
    if (upsert) {
      db.insert(media).values(values).onConflictDoUpdate({
        target: media.id,
        set: { contentType: values.contentType, fileName: values.fileName, fileSize: values.fileSize, storagePath: values.storagePath },
      }).run()
    }
    else {
      db.insert(media).values(values).run()
    }
    return true
  }

  try {
    db.transaction((tx) => {
      // Check quota inside transaction — SQLite serializes writes, so this is atomic
      const row = tx.select({ total: sql<number>`coalesce(sum(${media.fileSize}), 0)` })
        .from(media)
        .where(eq(media.userId, values.userId))
        .get()

      const used = row?.total || 0
      if ((used + values.fileSize) > mediaQuotaMb * 1024 * 1024) {
        throw new QuotaExceededError()
      }

      if (upsert) {
        tx.insert(media).values(values).onConflictDoUpdate({
          target: media.id,
          set: { contentType: values.contentType, fileName: values.fileName, fileSize: values.fileSize, storagePath: values.storagePath },
        }).run()
      }
      else {
        tx.insert(media).values(values).run()
      }
    })
    return true
  }
  catch (e) {
    if (e instanceof QuotaExceededError)
      return false
    throw e
  }
}

export function isS3Path(storagePath: string): boolean {
  return storagePath.startsWith('s3:')
}

export function s3KeyFromPath(storagePath: string): string {
  return storagePath.slice(3)
}

export function storagePathForMediaId(mediaId: string, s3Enabled: boolean): string {
  return s3Enabled ? `s3:${mediaId}` : join(MEDIA_DIR, mediaId)
}
