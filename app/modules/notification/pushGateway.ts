import type { pushers } from '@/db/schema'
import { pushGatewayUrl } from '@/config'

export interface PushNotification {
  event_id?: string
  room_id?: string
  type?: string
  sender?: string
  sender_display_name?: string
  room_name?: string
  room_alias?: string
  prio?: 'high' | 'low'
  content?: Record<string, unknown>
  counts?: {
    unread?: number
    missed_calls?: number
  }
  devices: Array<{
    app_id: string
    pushkey: string
    pushkey_ts?: number
    data?: Record<string, unknown>
  }>
}

export async function sendPushNotification(
  pusher: typeof pushers.$inferSelect,
  notification: PushNotification,
): Promise<void> {
  const url = (pusher.data as Record<string, unknown>)?.url as string | undefined || pushGatewayUrl
  if (!url) {
    logger.warn('push_no_url', { pusherId: pusher.id })
    return
  }

  // Block SSRF: reject private/internal hostnames
  try {
    const parsed = new URL(url)
    if (/^(?:localhost|127\.\d|10\.\d|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) {
      logger.warn('push_blocked_private_url', { url, pusherId: pusher.id })
      return
    }
  }
  catch {
    logger.warn('push_invalid_url', { url, pusherId: pusher.id })
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    await fetch(`${url}/_matrix/push/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification }),
      signal: controller.signal,
    })

    clearTimeout(timeout)
  }
  catch (err) {
    logger.error('push_failed', { error: err instanceof Error ? err.message : String(err), pusherId: pusher.id })
  }
}
