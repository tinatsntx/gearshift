CREATE TABLE `gearshift_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`value` text NOT NULL
);
