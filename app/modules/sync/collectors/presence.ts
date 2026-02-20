import { getPresenceForRoommates } from '@/modules/presence/service'

/**
 * Collect presence events for a user's roommates.
 * Only trusted devices receive presence data.
 */
export function collectPresenceEvents(userId: string, isTrusted: boolean) {
  if (!isTrusted) {
    return []
  }

  return getPresenceForRoommates(userId).map(p => ({
    type: 'm.presence' as const,
    sender: p.userId,
    content: {
      presence: p.state,
      last_active_ago: p.lastActiveAt ? Date.now() - p.lastActiveAt.getTime() : undefined,
      status_msg: p.statusMsg || undefined,
      currently_active: p.state === 'online',
    },
  }))
}
