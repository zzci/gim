import { sqlite } from '@/db'
import { collectGlobalAccountData } from './collectors/accountData'
import { collectDeviceListChanges, collectE2eeKeyCounts } from './collectors/deviceLists'
import { computeNextBatch, persistSyncPosition } from './collectors/position'
import { collectPresenceEvents } from './collectors/presence'
import { collectToDeviceMessages } from './collectors/toDevice'
import {
  buildInviteRoomData,
  buildJoinedRoomData,
  buildLeaveRoomData,
  getUserRoomMemberships,
  prefetchBatchSyncData,
} from './roomData'
import { resolveTrustContext } from './trust'

interface SyncOptions {
  userId: string
  deviceId: string
  isTrustedDevice: boolean
  since?: string
  timeout?: number
  fullState?: boolean
  setPresence?: string
}

export function buildSyncResponse(opts: SyncOptions) {
  const sinceId = opts.since || null
  const trust = resolveTrustContext(opts.userId, opts.deviceId, opts.isTrustedDevice, sinceId)
  const { trustedSinceId } = trust

  // Room memberships (empty for untrusted devices)
  const memberRooms = getUserRoomMemberships(opts.userId, trust.isTrusted)

  // Clean expired typing notifications once (not per-room)
  sqlite.prepare('DELETE FROM typing_notifications WHERE expires_at <= ?').run(Date.now())

  // Pre-fetch batch data for all joined rooms
  const joinedRoomIds = memberRooms.filter(mr => mr.membership === 'join').map(mr => mr.roomId)
  const batchData = prefetchBatchSyncData(joinedRoomIds, opts.userId, trustedSinceId)

  // Build room data
  const joinRooms: Record<string, any> = {}
  const inviteRooms: Record<string, any> = {}
  const leaveRooms: Record<string, any> = {}

  for (const mr of memberRooms) {
    if (mr.membership === 'join') {
      const roomData = buildJoinedRoomData(mr.roomId, opts.userId, trustedSinceId, batchData)
      if (roomData) {
        joinRooms[mr.roomId] = roomData
      }
    }
    else if (mr.membership === 'invite') {
      const roomData = buildInviteRoomData(mr.roomId, mr.eventId, trustedSinceId)
      if (roomData) {
        inviteRooms[mr.roomId] = roomData
      }
    }
    else if (mr.membership === 'leave') {
      const roomData = buildLeaveRoomData(mr.roomId, trustedSinceId)
      if (roomData) {
        leaveRooms[mr.roomId] = roomData
      }
    }
  }

  // Collectors — use trustedSinceId for account data, raw sinceId for to-device/device lists
  const globalAccountData = collectGlobalAccountData(opts.userId, trust.isTrusted, trustedSinceId)
  const toDevice = collectToDeviceMessages(opts.userId, opts.deviceId, trust.isTrusted, sinceId !== null)
  const deviceLists = collectDeviceListChanges(opts.userId, trust.isTrusted, sinceId)
  const keyCounts = collectE2eeKeyCounts(opts.userId, opts.deviceId)
  const presence = collectPresenceEvents(opts.userId, trust.isTrusted)

  const nextBatch = computeNextBatch(deviceLists.maxUlid, globalAccountData.maxStreamId)
  persistSyncPosition(opts.userId, opts.deviceId, trust.isTrusted, nextBatch)

  return {
    next_batch: nextBatch,
    rooms: {
      join: joinRooms,
      invite: inviteRooms,
      leave: leaveRooms,
    },
    account_data: { events: globalAccountData.events },
    presence: { events: presence },
    to_device: { events: toDevice.events },
    device_lists: {
      changed: deviceLists.changed,
      left: deviceLists.left,
    },
    device_one_time_keys_count: {
      signed_curve25519: keyCounts.otkCount,
    },
    device_unused_fallback_key_types: keyCounts.fallbackKeyAlgorithms,
  }
}
