import { waitForNotification } from '@/modules/sync/notifier'
import { decSyncConnections, incSyncConnections } from '@/shared/metrics'

export interface LongPollOptions<T> {
  userId: string
  timeout: number
  buildResponse: () => T
  hasChanges: (response: T) => boolean
}

/**
 * Generic long-poll: build response, check for changes, wait if empty, rebuild.
 * Manages sync connection counter for metrics.
 */
export async function longPoll<T>(opts: LongPollOptions<T>): Promise<T> {
  let response = opts.buildResponse()

  if (opts.timeout > 0 && !opts.hasChanges(response)) {
    incSyncConnections()
    try {
      const notified = await waitForNotification(opts.userId, opts.timeout)
      if (notified) {
        response = opts.buildResponse()
      }
    }
    finally {
      decSyncConnections()
    }
  }

  return response
}
