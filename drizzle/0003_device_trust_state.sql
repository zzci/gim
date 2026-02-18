ALTER TABLE `devices` ADD `trust_state` text NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
ALTER TABLE `devices` ADD `trust_reason` text NOT NULL DEFAULT 'new_login_unverified';
--> statement-breakpoint
ALTER TABLE `devices` ADD `verified_at` integer;
--> statement-breakpoint
ALTER TABLE `devices` ADD `verified_by_device_id` text;
