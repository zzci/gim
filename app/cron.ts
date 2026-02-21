import { unlink } from 'node:fs/promises'
import { Cron } from 'croner'
import { eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { mediaDeletions } from '@/db/schema'
import { invalidateTrustCache } from '@/models/device'
import { processAppServiceTransactions } from '@/modules/appservice/service'
import { expirePresence } from '@/modules/presence/service'
import { notifyUser } from '@/modules/sync/notifier'
import { deleteFromS3 } from '@/utils/s3'
import { generateUlid } from '@/utils/tokens'

const deviceInactiveDays = Number(process.env.IM_DEVICE_INACTIVE_DAYS) || 90

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
  const BATCH_SIZE = 100
  let totalProcessed = 0

  // Process all pending deletions in batches
  let hasMore = true
  while (hasMore) {
    const pending = db.select()
      .from(mediaDeletions)
      .where(isNull(mediaDeletions.completedAt))
      .limit(BATCH_SIZE)
      .all()

    if (pending.length === 0) {
      hasMore = false
      continue
    }

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

    totalProcessed += pending.length

    if (pending.length < BATCH_SIZE)
      hasMore = false
  }

  if (totalProcessed > 0) {
    logger.info('cron_media_deletions_processed', { count: totalProcessed })
  }
}

async function cleanupInactiveDevices() {
  const cutoffMs = Date.now() - (deviceInactiveDays * 24 * 60 * 60 * 1000)
  const BATCH_SIZE = 100

  // Find inactive devices that have no valid tokens
  const inactive = db.all<{ userId: string, deviceId: string }>(sql`
    SELECT d.user_id AS userId, d.id AS deviceId FROM devices d
    WHERE COALESCE(d.last_seen_at, d.created_at) < ${cutoffMs}
      AND NOT EXISTS (
        SELECT 1 FROM oauth_tokens ot
        WHERE ot.device_id = d.id
          AND ot.account_id = SUBSTR(d.user_id, 2, INSTR(d.user_id, ':') - 2)
          AND (ot.expires_at IS NULL OR ot.expires_at > ${Date.now()})
      )
      AND NOT EXISTS (
        SELECT 1 FROM account_tokens at2
        WHERE at2.device_id = d.id AND at2.user_id = d.user_id
      )
    LIMIT ${BATCH_SIZE}
  `)

  if (inactive.length === 0)
    return

  const affectedUsers = new Set<string>()

  for (const { userId, deviceId } of inactive) {
    db.transaction((tx) => {
      tx.run(sql`DELETE FROM e2ee_device_keys WHERE user_id = ${userId} AND device_id = ${deviceId}`)
      tx.run(sql`DELETE FROM e2ee_one_time_keys WHERE user_id = ${userId} AND device_id = ${deviceId}`)
      tx.run(sql`DELETE FROM e2ee_fallback_keys WHERE user_id = ${userId} AND device_id = ${deviceId}`)
      tx.run(sql`DELETE FROM e2ee_to_device_messages WHERE user_id = ${userId} AND device_id = ${deviceId}`)
      tx.run(sql`DELETE FROM devices WHERE user_id = ${userId} AND id = ${deviceId}`)
      tx.run(sql`INSERT INTO e2ee_device_list_changes (user_id, ulid) VALUES (${userId}, ${generateUlid()})`)
    })

    await invalidateTrustCache(userId, deviceId)
    affectedUsers.add(userId)
  }

  for (const userId of affectedUsers) {
    notifyUser(userId)
  }

  logger.info('cron_inactive_devices_cleaned', { count: inactive.length })
}

export function startCron() {
  // Run cleanup tasks immediately on startup
  try {
    cleanupOrphanedE2eeKeys()
  }
  catch (err) {
    logger.error('Startup cleanupOrphanedE2eeKeys failed', { error: String(err) })
  }
  try {
    cleanupExpiredTokens()
  }
  catch (err) {
    logger.error('Startup cleanupExpiredTokens failed', { error: String(err) })
  }

  const jobs = [
    new Cron('0 */6 * * *', () => {
      try {
        cleanupOrphanedE2eeKeys()
      }
      catch (err) {
        logger.error('Cron cleanupOrphanedE2eeKeys failed', { error: String(err) })
      }
    }),
    new Cron('0 */6 * * *', () => {
      try {
        cleanupExpiredTokens()
      }
      catch (err) {
        logger.error('Cron cleanupExpiredTokens failed', { error: String(err) })
      }
    }),
    new Cron('*/5 * * * *', async () => {
      try {
        await processMediaDeletions()
      }
      catch (err) {
        logger.error('Cron processMediaDeletions failed', { error: String(err) })
      }
    }),
    new Cron('* * * * *', () => {
      try {
        expirePresence()
      }
      catch (err) {
        logger.error('Cron expirePresence failed', { error: String(err) })
      }
    }),
    new Cron('*/5 * * * *', async () => {
      try {
        await processAppServiceTransactions()
      }
      catch (err) {
        logger.error('Cron processAppServiceTransactions failed', { error: String(err) })
      }
    }),
    new Cron('0 3 * * *', async () => {
      try {
        await cleanupInactiveDevices()
      }
      catch (err) {
        logger.error('Cron cleanupInactiveDevices failed', { error: String(err) })
      }
    }),
  ]

  logger.info('cron_started', { tasks: jobs.length })

  return function stopCron() {
    for (const job of jobs) job.stop()
    logger.info('cron_stopped')
  }
}
