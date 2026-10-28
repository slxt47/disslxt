CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "password_resets_token_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "tag" varchar(4);--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "tag_emoji" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "badge" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_emoji" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_text" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tag_guild_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tag_text" varchar(4);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tag_emoji" varchar(16);--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");