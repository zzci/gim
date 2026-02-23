CREATE INDEX `account_data_user_room_stream_idx` ON `account_data` (`user_id`,`room_id`,`stream_id`);--> statement-breakpoint
CREATE INDEX `account_filters_user_id_idx` ON `account_filters` (`user_id`);--> statement-breakpoint
CREATE INDEX `push_rules_user_id_idx` ON `push_rules` (`user_id`);--> statement-breakpoint
CREATE INDEX `typing_notifications_expires_at_idx` ON `typing_notifications` (`expires_at`);