import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// ---- Users ----
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // @user:server
  passwordHash: text('password_hash'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  isGuest: integer('is_guest', { mode: 'boolean' }).notNull().default(false),
  isDeactivated: integer('is_deactivated', { mode: 'boolean' }).notNull().default(false),
  admin: integer('admin', { mode: 'boolean' }).notNull().default(false),
})

// ---- User Profiles ----
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey().references((): AnySQLiteColumn => users.id),
  displayname: text('displayname'),
  avatarUrl: text('avatar_url'), // mxc:// URI
})

// ---- Devices ----
export const devices = sqliteTable('devices', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  id: text('id').notNull(), // device_id
  displayName: text('display_name'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
}, table => [
  primaryKey({ columns: [table.userId, table.id] }),
])

// ---- Access Tokens ----
export const accessTokens = sqliteTable('access_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  deviceId: text('device_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  refreshToken: text('refresh_token'),
})

// ---- Rooms ----
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), // !room:server
  version: text('version').notNull().default('11'),
  creatorId: text('creator_id').notNull(),
  isDirect: integer('is_direct', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

// ---- Room Membership ----
export const roomMembers = sqliteTable('room_members', {
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  membership: text('membership').notNull(), // join, invite, leave, ban, knock
  eventId: text('event_id').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, table => [
  primaryKey({ columns: [table.roomId, table.userId] }),
])

// ---- Events ----
export const events = sqliteTable('events', {
  id: text('id').primaryKey(), // $event_id
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
  sender: text('sender').notNull(), // @user:server
  type: text('type').notNull(), // m.room.message, m.room.member, etc.
  stateKey: text('state_key'), // null for timeline events, string for state events
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  originServerTs: integer('origin_server_ts').notNull(),
  unsigned: text('unsigned', { mode: 'json' }).$type<Record<string, unknown>>(),
  depth: integer('depth').notNull().default(0),
  streamOrder: integer('stream_order').notNull(),
}, table => [
  uniqueIndex('events_stream_order_idx').on(table.streamOrder),
])

// ---- Current Room State (materialized) ----
export const currentRoomState = sqliteTable('current_room_state', {
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
  type: text('type').notNull(),
  stateKey: text('state_key').notNull().default(''),
  eventId: text('event_id').notNull().references((): AnySQLiteColumn => events.id),
}, table => [
  primaryKey({ columns: [table.roomId, table.type, table.stateKey] }),
])

// ---- Room Aliases ----
export const roomAliases = sqliteTable('room_aliases', {
  alias: text('alias').primaryKey(), // #room:server
  roomId: text('room_id').notNull().references((): AnySQLiteColumn => rooms.id),
})

// ---- Account Data ----
export const accountData = sqliteTable('account_data', {
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  type: text('type').notNull(),
  roomId: text('room_id').default(''), // empty string = global
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
}, table => [
  primaryKey({ columns: [table.userId, table.type, table.roomId] }),
])

// ---- Filters ----
export const filters = sqliteTable('filters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  filterJson: text('filter_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
})

// ---- Device Keys (E2EE) ----
export const deviceKeys = sqliteTable('device_keys', {
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  algorithms: text('algorithms', { mode: 'json' }).notNull().$type<string[]>(),
  keys: text('keys', { mode: 'json' }).notNull().$type<Record<string, string>>(),
  signatures: text('signatures', { mode: 'json' }).notNull().$type<Record<string, Record<string, string>>>(),
  displayName: text('display_name'),
}, table => [
  primaryKey({ columns: [table.userId, table.deviceId] }),
])

// ---- One-Time Keys (E2EE) ----
export const oneTimeKeys = sqliteTable('one_time_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  algorithm: text('algorithm').notNull(),
  keyId: text('key_id').notNull(),
  keyJson: text('key_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  claimed: integer('claimed', { mode: 'boolean' }).notNull().default(false),
})

// ---- Fallback Keys (E2EE) ----
export const fallbackKeys = sqliteTable('fallback_keys', {
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  algorithm: text('algorithm').notNull(),
  keyId: text('key_id').notNull(),
  keyJson: text('key_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
}, table => [
  primaryKey({ columns: [table.userId, table.deviceId, table.algorithm] }),
])

// ---- Cross-Signing Keys ----
export const crossSigningKeys = sqliteTable('cross_signing_keys', {
  userId: text('user_id').notNull(),
  keyType: text('key_type').notNull(), // master, self_signing, user_signing
  keyData: text('key_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
}, table => [
  primaryKey({ columns: [table.userId, table.keyType] }),
])

// ---- Key Backup Versions ----
export const keyBackupVersions = sqliteTable('key_backup_versions', {
  version: text('version').primaryKey(),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  algorithm: text('algorithm').notNull(),
  authData: text('auth_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  etag: text('etag').notNull(),
  count: integer('count').notNull().default(0),
})

// ---- Key Backup Data ----
export const keyBackupData = sqliteTable('key_backup_data', {
  userId: text('user_id').notNull(),
  version: text('version').notNull(),
  roomId: text('room_id').notNull(),
  sessionId: text('session_id').notNull(),
  sessionData: text('session_data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
}, table => [
  primaryKey({ columns: [table.userId, table.version, table.roomId, table.sessionId] }),
])

// ---- Push Rules ----
export const pushRules = sqliteTable('push_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references((): AnySQLiteColumn => users.id),
  kind: text('kind').notNull(), // override, underride, sender, room, content
  ruleId: text('rule_id').notNull(),
  conditions: text('conditions', { mode: 'json' }).$type<Record<string, unknown>[]>(),
  actions: text('actions', { mode: 'json' }).notNull().$type<unknown[]>(),
  pattern: text('pattern'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
})

// ---- Media ----
export const media = sqliteTable('media', {
  id: text('id').primaryKey(), // media ID portion of mxc://
  userId: text('user_id').notNull(),
  contentType: text('content_type').notNull(),
  fileName: text('file_name'),
  fileSize: integer('file_size').notNull(),
  storagePath: text('storage_path').notNull(), // local path or S3 key
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
})

// ---- To-Device Messages ----
export const toDeviceMessages = sqliteTable('to_device_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  type: text('type').notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  sender: text('sender').notNull(),
  streamId: integer('stream_id').notNull(),
})

// ---- Read Receipts ----
export const readReceipts = sqliteTable('read_receipts', {
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  eventId: text('event_id').notNull(),
  receiptType: text('receipt_type').notNull(), // m.read, m.read.private, m.fully_read
  ts: integer('ts', { mode: 'number' }).notNull(),
}, table => [
  primaryKey({ columns: [table.roomId, table.userId, table.receiptType] }),
])

// ---- Typing Notifications (transient, but stored briefly for sync) ----
export const typingNotifications = sqliteTable('typing_notifications', {
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
}, table => [
  primaryKey({ columns: [table.roomId, table.userId] }),
])
