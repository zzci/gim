CREATE INDEX `account_data_user_room_idx` ON `account_data` (`user_id`,`room_id`);--> statement-breakpoint
CREATE INDEX `e2ee_device_list_changes_user_idx` ON `e2ee_device_list_changes` (`user_id`);