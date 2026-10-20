CREATE TABLE `api_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`request_ms` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`audio_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`ts` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `api_calls_job_idx` ON `api_calls` (`job_id`);--> statement-breakpoint
CREATE INDEX `api_calls_ts_idx` ON `api_calls` (`ts`);--> statement-breakpoint
CREATE TABLE `cues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subtitle_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`text` text NOT NULL,
	`speaker_gender` text DEFAULT 'u' NOT NULL,
	`source_cue_id` integer,
	`edited` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`subtitle_id`) REFERENCES `subtitles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cues_subtitle_idx` ON `cues` (`subtitle_id`,`idx`);--> statement-breakpoint
CREATE TABLE `glossaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `glossaries_project_id_unique` ON `glossaries` (`project_id`);--> statement-breakpoint
CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`ts` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`level` text NOT NULL,
	`stage` text,
	`message` text NOT NULL,
	`data` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_logs_job_idx` ON `job_logs` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_file_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text,
	`progress` real DEFAULT 0 NOT NULL,
	`source_lang` text DEFAULT 'auto' NOT NULL,
	`detected_lang` text,
	`target_lang` text NOT NULL,
	`timing_source` text,
	`stt_model` text,
	`translate_model` text,
	`options` text DEFAULT '{}' NOT NULL,
	`output_path` text,
	`output_encoding` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`audio_seconds` real DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_media_idx` ON `jobs` (`media_file_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`path` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_sec` real,
	`audio_tracks` text DEFAULT '[]' NOT NULL,
	`subtitle_tracks` text DEFAULT '[]' NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_files_path_unique` ON `media_files` (`path`);--> statement-breakpoint
CREATE INDEX `media_files_project_idx` ON `media_files` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`default_source_lang` text DEFAULT 'auto' NOT NULL,
	`default_target_lang` text DEFAULT 'hr' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`kind` text NOT NULL,
	`language` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitles_job_idx` ON `subtitles` (`job_id`);