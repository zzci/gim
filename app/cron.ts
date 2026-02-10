import { unlink } from 'node:fs/promises'
import { Cron } from 'croner'
import { eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { mediaDeletions } from '@/db/schema'
import { expirePresence } from '@/modules/presence/service'
import { deleteFromS3 } from '@/utils/s3'

function cleanupOrphanedE2eeKeys() {
  // Delete device keys for devices that no longer exist
  db.run(sql`DELETE FROM e2ee_device_keys WHERE NOT EXISTS (
    SELECT 1 FROM devices WHERE devices.user_id = e2ee_device_keys.user_id AND devices.id = e2ee_device_keys.device_id
  )`)

  // Delete one-time keys for devices that no longer exist
  db.run(sql`DELETE FROM e2ee_one_time_keys WHERE NOT EXISTS (
    SELECT 1 FROM devices WHERE devices.user_id = e2ee_one_time_keys.user_id AND devices.id = e2ee_one_time_keys.device_id
  )`)

  // Delete fallback keys for devices that no longer exist
  db.run(sql`DELETE FROM e2ee_fallback_keys WHERE NOT EXISTS (
    SELECT 1 FROM devices WHERE devices.user_id = e2ee_fallback_keys.user_id AND devices.id = e2ee_fallback_keys.device_id
  )`)

  // Delete to-device messages for devices that no longer exist
  db.run(sql`DELETE FROM e2ee_to_device_messages WHERE NOT EXISTS (
    SELECT 1 FROM devices WHERE devices.user_id = e2ee_to_device_messages.user_id AND devices.id = e2ee_to_device_messages.device_id
  )`)

  logger.debug('cron_orphaned_e2ee_keys_cleaned')
}

function cleanupExpiredTokens() {
  db.run(sql`DELETE FROM oauth_tokens WHERE expires_at IS NOT NULL AND expires_at < ${Date.now()}`)
  db.run(sql`DELETE FROM oauth_tokens WHERE type = 'LoginToken' AND consumed_at IS NOT NULL`)

  logger.debug('cron_expired_tokens_cleaned')
}

async function processMediaDeletions() {
  const pending = db.select()
    .from(mediaDeletions)
    .where(isNull(mediaDeletions.completedAt))
    .limit(100)
    .all()

  for (const item of pending) {
    try {
      if (item.storagePath.startsWith('s3:')) {
        await deleteFromS3(item.storagePath.slice(3))
      }
      else {
        await unlink(item.storagePath)
      }
    }
    catch { /* best effort — file may already be gone */ }

    db.update(mediaDeletions)
      .set({ completedAt: new Date() })
      .where(eq(mediaDeletions.id, item.id))
      .run()
  }

  if (pending.length > 0) {
    logger.info(`cron_media_deletions_processed`, { count: pending.length })
  }
}

export function startCron() {
  // Run cleanup tasks immediately on startup
  cleanupOrphanedE2eeKeys()
  cleanupExpiredTokens()

  const jobs = [
    new Cron('0 */6 * * *', cleanupOrphanedE2eeKeys),
    new Cron('0 */6 * * *', cleanupExpiredTokens),
    new Cron('*/5 * * * *', () => { processMediaDeletions().catch(() => {}) }),
    new Cron('* * * * *', expirePresence),
  ]

  logger.info('cron_started', { tasks: jobs.length })

  return function stopCron() {
    for (const job of jobs) job.stop()
    logger.info('cron_stopped')
  }
}
