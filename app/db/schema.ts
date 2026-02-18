import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { generateUlid } from '@/utils/tokens'

// ======== Accounts ========

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), // @user:server
  displayname: text('displayname'),
  avatarUrl: text('avatar_url'), // mxc:// URI
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  isGuest: integer('is_guest', { mode: 'boolean' }).notNull().default(false),
  isDeactivated: integer('is_deactivated', { mode: 'boolean' }).notNull().default(false),
  admin: integer('admin', { mode: 'boolean' }).notNull().default(false),
})

export const accountTokens = sqliteTable('account_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  deviceId: text('device_id').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
}, table => [
  index('account_tokens_user_id_idx').on(table.userId),
])

export const accountData = sqliteTable('account_data', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  type: text('type').notNull(),
  roomId: text('room_id').default(''), // empty string = global
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  streamId: text('stream_id').notNull().$defaultFn(generateUlid),
}, table => [
  primaryKey({ columns: [table.userId, table.type, table.roomId] }),
])

export const accountDataCrossSigning = sqliteTable('account_data_cross_signing', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  keyType: text('key_type').notNull(), // master | self_signing | user_signing
  keyData: text('key_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
}, table => [
  primaryKey({ columns: [table.userId, table.keyType] }),
])

export const accountFilters = sqliteTable('account_filters', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  filterJson: text('filter_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
})

// ======== Auth ========

export const oauthTokens = sqliteTable('oauth_tokens', {
  id: text('id').primaryKey(), // "{Type}:{jti}" for uniqueness
  type: text('type').notNull(), // AccessToken, RefreshToken, Grant, AuthorizationCode
  accountId: text('account_id'), // user localpart (e.g. "roy")
  deviceId: text('device_id'), // extracted from scope for tokens
  clientId: text('client_id'),
  scope: text('scope'),
  grantId: text('grant_id'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().default({}), // AuthorizationCode extra params only
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
}, table => [
  index('oauth_tokens_account_id_idx').on(table.accountId),
  index('oauth_tokens_grant_id_idx').on(table.grantId),
  index('oauth_tokens_device_id_idx').on(table.deviceId),
])

// ======== Devices ========

export const devices = sqliteTable('devices', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  id: text('id').notNull(), // device_id
  displayName: text('display_name'),
  trustState: text('trust_state').notNull().default('unverified'), // trusted | unverified | blocked
  trustReason: text('trust_reason').notNull().default('new_login_unverified'),
  verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
  verifiedByDeviceId: text('verified_by_device_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  lastToDeviceStreamId: integer('last_to_device_stream_id').notNull().default(0),
  lastSyncBatch: text('last_sync_batch'),
  pendingKeyChange: integer('pending_key_change', { mode: 'boolean' }).notNull().default(false),
}, table => [
  primaryKey({ columns: [table.userId, table.id] }),
])

// ======== Rooms ========

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), // !room:server
  version: text('version').notNull().default('12'),
  creatorId: text('creator_id').notNull(),
  isDirect: integer('is_direct', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

export const roomMembers = sqliteTable('room_members', {
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  membership: text('membership').notNull(), // join, invite, leave, ban, knock
  eventId: text('event_id').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  primaryKey({ columns: [table.roomId, table.userId] }),
  index('room_members_user_membership_idx').on(table.userId, table.membership),
])

export const roomAliases = sqliteTable('room_aliases', {
  alias: text('alias').primaryKey(), // #room:server
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
})

// ======== Events ========

export const eventsState = sqliteTable('events_state', {
  id: text('id').primaryKey(), // ULID (= ordering key)
  roomId: text('room_id').notNull(),
  sender: text('sender').notNull(),
  type: text('type').notNull(),
  stateKey: text('state_key').notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  originServerTs: integer('origin_server_ts').notNull(),
  unsigned: text('unsigned', { mode: 'json' }).$type<Record<string, unknown>>(),
}, table => [
  index('events_state_room_id_idx').on(table.roomId, table.id),
])

export const eventsTimeline = sqliteTable('events_timeline', {
  id: text('id').primaryKey(), // ULID (= ordering key)
  roomId: text('room_id').notNull(),
  sender: text('sender').notNull(),
  type: text('type').notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  originServerTs: integer('origin_server_ts').notNull(),
  unsigned: text('unsigned', { mode: 'json' }).$type<Record<string, unknown>>(),
}, table => [
  index('events_timeline_room_id_idx').on(table.roomId, table.id),
])

export const eventsAttachments = sqliteTable('events_attachments', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  eventId: text('event_id').notNull(),
  mediaId: text('media_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  index('events_attachments_event_idx').on(table.eventId),
  index('events_attachments_media_idx').on(table.mediaId),
])

export const currentRoomState = sqliteTable('current_room_state', {
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
  type: text('type').notNull(),
  stateKey: text('state_key').notNull().default(''),
  eventId: text('event_id').notNull().references((): AnySQLiteColumn => eventsState.id),
}, table => [
  primaryKey({ columns: [table.roomId, table.type, table.stateKey] }),
])

// ======== E2EE ========

export const e2eeDeviceKeys = sqliteTable('e2ee_device_keys', {
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  algorithms: text('algorithms', { mode: 'json' }).notNull().$type<string[]>(),
  keys: text('keys', { mode: 'json' }).notNull().$type<Record<string, string>>(),
  signatures: text('signatures', { mode: 'json' }).notNull().$type<Record<string, Record<string, string>>>(),
  displayName: text('display_name'),
}, table => [
  primaryKey({ columns: [table.userId, table.deviceId] }),
])

export const e2eeOneTimeKeys = sqliteTable('e2ee_one_time_keys', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  algorithm: text('algorithm').notNull(),
  keyId: text('key_id').notNull(),
  keyJson: text('key_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  claimed: integer('claimed', { mode: 'boolean' }).notNull().default(false),
}, table => [
  index('e2ee_otk_user_device_claimed_idx').on(table.userId, table.deviceId, table.claimed),
])

export const e2eeFallbackKeys = sqliteTable('e2ee_fallback_keys', {
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  algorithm: text('algorithm').notNull(),
  keyId: text('key_id').notNull(),
  keyJson: text('key_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
}, table => [
  primaryKey({ columns: [table.userId, table.deviceId, table.algorithm] }),
])

export const e2eeToDeviceMessages = sqliteTable('e2ee_to_device_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  type: text('type').notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  sender: text('sender').notNull(),
}, table => [
  index('e2ee_to_device_user_device_idx').on(table.userId, table.deviceId),
])

export const e2eeDeviceListChanges = sqliteTable('e2ee_device_list_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(), // the user whose device list changed
  ulid: text('ulid').notNull(),
}, table => [
  index('e2ee_device_list_changes_ulid_idx').on(table.ulid),
])

export const e2eeDehydratedDevices = sqliteTable('e2ee_dehydrated_devices', {
  userId: text('user_id').primaryKey().references((): AnySQLiteColumn => accounts.id),
  deviceId: text('device_id').notNull(),
  deviceData: text('device_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

export const e2eeRoomKeyBackups = sqliteTable('e2ee_room_key_backups', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  version: text('version').notNull(),
  algorithm: text('algorithm').notNull(),
  authData: text('auth_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  etag: integer('etag').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  primaryKey({ columns: [table.userId, table.version] }),
  index('e2ee_room_key_backups_user_idx').on(table.userId),
])

export const e2eeRoomKeyBackupKeys = sqliteTable('e2ee_room_key_backup_keys', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  version: text('version').notNull(),
  roomId: text('room_id').notNull(),
  sessionId: text('session_id').notNull(),
  keyData: text('key_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  primaryKey({ columns: [table.userId, table.version, table.roomId, table.sessionId] }),
  index('e2ee_room_key_backup_keys_user_ver_idx').on(table.userId, table.version),
])

// ======== Media ========

export const media = sqliteTable('media', {
  id: text('id').primaryKey(), // media ID portion of mxc://
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  contentType: text('content_type').notNull(),
  fileName: text('file_name'),
  fileSize: integer('file_size').notNull(),
  storagePath: text('storage_path').notNull(), // local path or S3 key
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  index('media_user_id_idx').on(table.userId),
])

export const mediaDeletions = sqliteTable('media_deletions', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  mediaId: text('media_id').notNull(),
  storagePath: text('storage_path').notNull(),
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
}, table => [
  index('media_deletions_completed_at_idx').on(table.completedAt),
])

// ======== Push ========

export const pushNotifications = sqliteTable('push_notifications', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  userId: text('user_id').notNull(),
  roomId: text('room_id').notNull(),
  eventId: text('event_id').notNull(),
  actions: text('actions', { mode: 'json' }).notNull().$type<unknown[]>(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  ts: integer('ts').notNull(),
}, table => [
  index('push_notifications_user_id_idx').on(table.userId),
])

export const pushers = sqliteTable('pushers', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  deviceId: text('device_id'),
  kind: text('kind').notNull(),
  appId: text('app_id').notNull(),
  pushkey: text('pushkey').notNull(),
  appDisplayName: text('app_display_name'),
  deviceDisplayName: text('device_display_name'),
  profileTag: text('profile_tag'),
  lang: text('lang'),
  data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  index('pushers_user_id_idx').on(table.userId),
])

export const pushRules = sqliteTable('push_rules', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => accounts.id),
  kind: text('kind').notNull(), // override, underride, sender, room, content
  ruleId: text('rule_id').notNull(),
  conditions: text('conditions', { mode: 'json' }).$type<Record<string, unknown>[]>(),
  actions: text('actions', { mode: 'json' }).notNull().$type<unknown[]>(),
  pattern: text('pattern'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
})

// ======== Sync (ephemeral) ========

export const readReceipts = sqliteTable('read_receipts', {
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  eventId: text('event_id').notNull(),
  receiptType: text('receipt_type').notNull(), // m.read, m.read.private, m.fully_read
  ts: integer('ts', { mode: 'number' }).notNull(),
}, table => [
  primaryKey({ columns: [table.roomId, table.userId, table.receiptType] }),
])

export const typingNotifications = sqliteTable('typing_notifications', {
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
}, table => [
  primaryKey({ columns: [table.roomId, table.userId] }),
])

// ======== Presence ========

export const presence = sqliteTable('presence', {
  userId: text('user_id').primaryKey().references((): AnySQLiteColumn => accounts.id),
  state: text('state').notNull().default('offline'), // online, unavailable, offline
  statusMsg: text('status_msg'),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

// ======== Application Services ========

export const appservices = sqliteTable('appservices', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  asId: text('as_id').notNull().unique(), // AS-declared identifier
  url: text('url'),
  asToken: text('as_token').notNull().unique(),
  hsToken: text('hs_token').notNull(),
  senderLocalpart: text('sender_localpart').notNull(),
  namespaces: text('namespaces', { mode: 'json' }).notNull().$type<{
    users?: { exclusive?: boolean, regex: string }[]
    aliases?: { exclusive?: boolean, regex: string }[]
    rooms?: { exclusive?: boolean, regex: string }[]
  }>().default({}),
  rateLimited: integer('rate_limited', { mode: 'boolean' }).default(false),
  protocols: text('protocols', { mode: 'json' }).$type<string[]>(),
  // Delivery state
  lastStreamPosition: text('last_stream_position').notNull().default(''),
  lastTxnId: integer('last_txn_id').notNull().default(0),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lastFailureAt: integer('last_failure_at', { mode: 'timestamp_ms' }),
  lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

// ======== Admin ========

export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: text('id').primaryKey().$defaultFn(generateUlid),
  adminUserId: text('admin_user_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  index('admin_audit_log_admin_user_id_idx').on(table.adminUserId),
  index('admin_audit_log_created_at_idx').on(table.createdAt),
])
