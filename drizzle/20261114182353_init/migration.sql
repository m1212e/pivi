CREATE TABLE "app_usage" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL,
	"app_id" text NOT NULL,
	"last_used_at" timestamp NOT NULL,
	CONSTRAINT "app_usage_user_id_app_id_unique" UNIQUE("user_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "installed_app" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"app_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"image_ref" text NOT NULL,
	"image_digest" text NOT NULL,
	"image_command" jsonb NOT NULL,
	"image_working_dir" text,
	"signer" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_update" boolean DEFAULT true NOT NULL,
	"approved_manifest" jsonb NOT NULL,
	"granted_permissions" jsonb DEFAULT '[]' NOT NULL,
	"pending_update" jsonb,
	"ignored_digest" text,
	"last_checked_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "paired_device" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"public_key" text NOT NULL,
	"name" text,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tv_identity" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"public_key" text NOT NULL,
	"secret_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"username" text NOT NULL UNIQUE,
	"pin_hash" text NOT NULL,
	"image" text
);
--> statement-breakpoint
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;