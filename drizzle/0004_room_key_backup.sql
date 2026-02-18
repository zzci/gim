CREATE TABLE `e2ee_room_key_backups` (
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`algorithm` text NOT NULL,
	`auth_data` text NOT NULL,
	`etag` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	`updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	PRIMARY KEY(`user_id`, `version`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `e2ee_room_key_backups_user_idx` ON `e2ee_room_key_backups` (`user_id`);
--> statement-breakpoint
CREATE TABLE `e2ee_room_key_backup_keys` (
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`room_id` text NOT NULL,
	`session_id` text NOT NULL,
	`key_data` text NOT NULL,
	`updated_at` integer NOT NULL DEFAULT (unixepoch() * 1000),
	PRIMARY KEY(`user_id`, `version`, `room_id`, `session_id`),
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `e2ee_room_key_backup_keys_user_ver_idx` ON `e2ee_room_key_backup_keys` (`user_id`, `version`);
