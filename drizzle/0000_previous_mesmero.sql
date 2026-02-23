CREATE TABLE `account_data` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`room_id` text DEFAULT '',
	`content` text NOT NULL,
	`stream_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `type`, `room_id`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_data_cross_signing` (
	`user_id` text NOT NULL,
	`key_type` text NOT NULL,
	`key_data` text NOT NULL,
	PRIMARY KEY(`user_id`, `key_type`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`filter_json` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_tokens_user_id_idx` ON `account_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`displayname` text,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`is_guest` integer DEFAULT false NOT NULL,
	`is_deactivated` integer DEFAULT false NOT NULL,
	`admin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`details` text,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_admin_user_id_idx` ON `admin_audit_log` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_created_at_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `appservices` (
	`id` text PRIMARY KEY NOT NULL,
	`as_id` text NOT NULL,
	`url` text,
	`as_token` text NOT NULL,
	`hs_token` text NOT NULL,
	`sender_localpart` text NOT NULL,
	`namespaces` text DEFAULT '{}' NOT NULL,
	`rate_limited` integer DEFAULT false,
	`protocols` text,
	`last_stream_position` text DEFAULT '' NOT NULL,
	`last_txn_id` integer DEFAULT 0 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_failure_at` integer,
	`last_success_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appservices_as_id_unique` ON `appservices` (`as_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appservices_as_token_unique` ON `appservices` (`as_token`);--> statement-breakpoint
CREATE TABLE `current_room_state` (
	`room_id` text NOT NULL,
	`type` text NOT NULL,
	`state_key` text DEFAULT '' NOT NULL,
	`event_id` text NOT NULL,
	PRIMARY KEY(`room_id`, `type`, `state_key`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events_state`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`display_name` text,
	`trust_state` text DEFAULT 'unverified' NOT NULL,
	`trust_reason` text DEFAULT 'new_login_unverified' NOT NULL,
	`verified_at` integer,
	`verified_by_device_id` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer,
	`last_to_device_stream_id` integer DEFAULT 0 NOT NULL,
	`last_sync_batch` text,
	`pending_key_change` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `e2ee_dehydrated_devices` (
	`user_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`device_data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `e2ee_device_keys` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`algorithms` text NOT NULL,
	`keys` text NOT NULL,
	`signatures` text NOT NULL,
	`display_name` text,
	PRIMARY KEY(`user_id`, `device_id`)
);
--> statement-breakpoint
CREATE TABLE `e2ee_device_list_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`ulid` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `e2ee_device_list_changes_ulid_idx` ON `e2ee_device_list_changes` (`ulid`);--> statement-breakpoint
CREATE TABLE `e2ee_fallback_keys` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`key_id` text NOT NULL,
	`key_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`, `algorithm`)
);
--> statement-breakpoint
CREATE TABLE `e2ee_one_time_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`key_id` text NOT NULL,
	`key_json` text NOT NULL,
	`claimed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `e2ee_otk_user_device_claimed_idx` ON `e2ee_one_time_keys` (`user_id`,`device_id`,`claimed`);--> statement-breakpoint
CREATE TABLE `e2ee_room_key_backup_keys` (
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`room_id` text NOT NULL,
	`session_id` text NOT NULL,
	`key_data` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `version`, `room_id`, `session_id`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `e2ee_room_key_backup_keys_user_ver_idx` ON `e2ee_room_key_backup_keys` (`user_id`,`version`);--> statement-breakpoint
CREATE TABLE `e2ee_room_key_backups` (
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`algorithm` text NOT NULL,
	`auth_data` text NOT NULL,
	`etag` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `version`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `e2ee_room_key_backups_user_idx` ON `e2ee_room_key_backups` (`user_id`);--> statement-breakpoint
CREATE TABLE `e2ee_to_device_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`sender` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `e2ee_to_device_user_device_idx` ON `e2ee_to_device_messages` (`user_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `events_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`media_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_attachments_event_idx` ON `events_attachments` (`event_id`);--> statement-breakpoint
CREATE INDEX `events_attachments_media_idx` ON `events_attachments` (`media_id`);--> statement-breakpoint
CREATE TABLE `events_state` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`sender` text NOT NULL,
	`type` text NOT NULL,
	`state_key` text NOT NULL,
	`content` text NOT NULL,
	`origin_server_ts` integer NOT NULL,
	`unsigned` text
);
--> statement-breakpoint
CREATE INDEX `events_state_room_id_idx` ON `events_state` (`room_id`,`id`);--> statement-breakpoint
CREATE TABLE `events_timeline` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`sender` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`origin_server_ts` integer NOT NULL,
	`unsigned` text
);
--> statement-breakpoint
CREATE INDEX `events_timeline_room_id_idx` ON `events_timeline` (`room_id`,`id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_type` text NOT NULL,
	`file_name` text,
	`file_size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_user_id_idx` ON `media` (`user_id`);--> statement-breakpoint
CREATE TABLE `media_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`requested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `media_deletions_completed_at_idx` ON `media_deletions` (`completed_at`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`account_id` text,
	`device_id` text,
	`client_id` text,
	`scope` text,
	`grant_id` text,
	`payload` text DEFAULT '{}',
	`expires_at` integer,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_account_id_idx` ON `oauth_tokens` (`account_id`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant_id_idx` ON `oauth_tokens` (`grant_id`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_device_id_idx` ON `oauth_tokens` (`device_id`);--> statement-breakpoint
CREATE TABLE `presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'offline' NOT NULL,
	`status_msg` text,
	`last_active_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `push_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`room_id` text NOT NULL,
	`event_id` text NOT NULL,
	`actions` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_notifications_user_id_idx` ON `push_notifications` (`user_id`);--> statement-breakpoint
CREATE TABLE `push_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`rule_id` text NOT NULL,
	`conditions` text,
	`actions` text NOT NULL,
	`pattern` text,
	`is_default` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pushers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`kind` text NOT NULL,
	`app_id` text NOT NULL,
	`pushkey` text NOT NULL,
	`app_display_name` text,
	`device_display_name` text,
	`profile_tag` text,
	`lang` text,
	`data` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pushers_user_id_idx` ON `pushers` (`user_id`);--> statement-breakpoint
CREATE TABLE `read_receipts` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`receipt_type` text NOT NULL,
	`ts` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`, `receipt_type`)
);
--> statement-breakpoint
CREATE TABLE `room_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `room_members` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership` text NOT NULL,
	`event_id` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `room_members_user_membership_idx` ON `room_members` (`user_id`,`membership`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text DEFAULT '12' NOT NULL,
	`creator_id` text NOT NULL,
	`is_direct` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `typing_notifications` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`)
);
