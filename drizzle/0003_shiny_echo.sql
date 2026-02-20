ALTER TABLE `e2ee_fallback_keys` ADD `used` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `current_room_state_room_type_idx` ON `current_room_state` (`room_id`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `e2ee_otk_unique_key` ON `e2ee_one_time_keys` (`user_id`,`device_id`,`algorithm`,`key_id`);--> statement-breakpoint
CREATE INDEX `presence_state_last_active_idx` ON `presence` (`state`,`last_active_at`);