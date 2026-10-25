CREATE TYPE "public"."account_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('active', 'rate_limited', 'disabled', 'target_missing');--> statement-breakpoint
CREATE TYPE "public"."provider_id" AS ENUM('bluesky', 'mastodon', 'discord', 'telegram', 'slack', 'linkedin', 'pinterest', 'youtube', 'facebook', 'instagram', 'threads', 'tiktok');--> statement-breakpoint
CREATE TYPE "public"."attempt_outcome" AS ENUM('success', 'pending', 'retryable_error', 'fatal_error', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'pending_approval', 'scheduled', 'queued', 'publishing', 'processing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" "provider_id" NOT NULL,
	"target_type" text NOT NULL,
	"external_target_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"avatar_url" text,
	"status" "channel_status" DEFAULT 'active' NOT NULL,
	"default_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider_id" NOT NULL,
	"provider_app_id" uuid,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider_id" NOT NULL,
	"provider_app_id" uuid,
	"code_verifier_enc" "bytea",
	"dpop_jwk_enc" "bytea",
	"key_version" smallint,
	"redirect_to" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '10 minutes' NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_sessions_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "provider_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider_id" NOT NULL,
	"instance_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" "bytea" NOT NULL,
	"key_version" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"base_body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_groups_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "post_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text DEFAULT 'post' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "item_status" DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"external_url" text,
	"external_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_items_position_nonnegative" CHECK ("post_items"."position" >= 0),
	CONSTRAINT "post_items_kind_valid" CHECK ("post_items"."kind" in ('post', 'reply', 'first_comment'))
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text,
	"external_url" text,
	"external_container_id" text,
	"publish_checkpoint" jsonb,
	"next_check_at" timestamp with time zone,
	"processing_deadline_at" timestamp with time zone,
	"error_kind" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "posts_scheduled_has_time" CHECK ("posts"."status" <> 'scheduled' or "posts"."scheduled_at" is not null),
	CONSTRAINT "posts_processing_has_check" CHECK ("posts"."status" <> 'processing' or "posts"."next_check_at" is not null),
	CONSTRAINT "posts_error_kind_valid" CHECK ("posts"."error_kind" is null or "posts"."error_kind" in ('auth', 'rate_limit', 'validation', 'transient', 'expired', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "publish_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"post_item_id" uuid,
	"attempt_no" integer NOT NULL,
	"stage" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "attempt_outcome",
	"error_kind" text,
	"http_status" smallint,
	"response_redacted" jsonb
);
--> statement-breakpoint
CREATE TABLE "account_credentials" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"refresh_token_enc" "bytea",
	"expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"dpop_jwk_enc" "bytea",
	"key_version" smallint NOT NULL,
	"refreshed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_account_fk" FOREIGN KEY ("account_id","workspace_id") REFERENCES "public"."connected_accounts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_provider_app_id_provider_apps_id_fk" FOREIGN KEY ("provider_app_id") REFERENCES "public"."provider_apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_connected_by_profiles_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_provider_app_id_provider_apps_id_fk" FOREIGN KEY ("provider_app_id") REFERENCES "public"."provider_apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_groups" ADD CONSTRAINT "post_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_groups" ADD CONSTRAINT "post_groups_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_items" ADD CONSTRAINT "post_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_items" ADD CONSTRAINT "post_items_post_fk" FOREIGN KEY ("post_id","workspace_id") REFERENCES "public"."posts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_fk" FOREIGN KEY ("group_id","workspace_id") REFERENCES "public"."post_groups"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_fk" FOREIGN KEY ("channel_id","workspace_id") REFERENCES "public"."channels"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_post_item_id_post_items_id_fk" FOREIGN KEY ("post_item_id") REFERENCES "public"."post_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_post_fk" FOREIGN KEY ("post_id","workspace_id") REFERENCES "public"."posts"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_credentials" ADD CONSTRAINT "account_credentials_account_id_connected_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_external_idx" ON "channels" USING btree ("workspace_id","provider","external_target_id");--> statement-breakpoint
CREATE INDEX "channels_account_idx" ON "channels" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_external_idx" ON "connected_accounts" USING btree ("workspace_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "oauth_sessions_expires_idx" ON "oauth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_apps_instance_idx" ON "provider_apps" USING btree ("provider","instance_url");--> statement-breakpoint
CREATE INDEX "post_groups_workspace_idx" ON "post_groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_items_position_idx" ON "post_items" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "posts_due_idx" ON "posts" USING btree ("scheduled_at") WHERE "posts"."status" = 'scheduled' and "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_check_idx" ON "posts" USING btree ("next_check_at") WHERE "posts"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "posts_calendar_idx" ON "posts" USING btree ("workspace_id","scheduled_at") WHERE "posts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "posts_group_idx" ON "posts" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "posts_channel_idx" ON "posts" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "publish_attempts_post_idx" ON "publish_attempts" USING btree ("post_id","started_at");