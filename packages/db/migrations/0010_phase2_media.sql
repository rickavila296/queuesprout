CREATE TYPE "public"."media_retention" AS ENUM('library', 'auto');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('uploading', 'processing', 'ready', 'failed', 'purged');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"status" "media_status" DEFAULT 'uploading' NOT NULL,
	"retention" "media_retention" DEFAULT 'auto' NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"sha256" text,
	"thumbnail_key" text,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"last_used_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_assets_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "media_assets_bytes_positive" CHECK ("media_assets"."bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "post_item_media" (
	"workspace_id" uuid NOT NULL,
	"post_item_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"media_id" uuid NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_item_media_post_item_id_position_pk" PRIMARY KEY("post_item_id","position"),
	CONSTRAINT "post_item_media_item_media_key" UNIQUE("post_item_id","media_id"),
	CONSTRAINT "post_item_media_position_nonnegative" CHECK ("post_item_media"."position" >= 0),
	CONSTRAINT "post_item_media_alt_length" CHECK (char_length("post_item_media"."alt_text") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "post_items" ADD CONSTRAINT "post_items_id_workspace_key" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_item_media" ADD CONSTRAINT "post_item_media_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_item_media" ADD CONSTRAINT "post_item_media_item_fk" FOREIGN KEY ("post_item_id","workspace_id") REFERENCES "public"."post_items"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_item_media" ADD CONSTRAINT "post_item_media_media_fk" FOREIGN KEY ("media_id","workspace_id") REFERENCES "public"."media_assets"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_library_idx" ON "media_assets" USING btree ("workspace_id","created_at") WHERE "media_assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "media_assets_processing_idx" ON "media_assets" USING btree ("updated_at") WHERE "media_assets"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "post_item_media_media_idx" ON "post_item_media" USING btree ("media_id");
