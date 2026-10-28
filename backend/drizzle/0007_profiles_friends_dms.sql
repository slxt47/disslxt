CREATE TABLE "dm_members" (
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "dm_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_requester_id_addressee_id_pk" PRIMARY KEY("requester_id","addressee_id"),
	CONSTRAINT "friendships_not_self_chk" CHECK ("friendships"."requester_id" <> "friendships"."addressee_id"),
	CONSTRAINT "friendships_status_chk" CHECK ("friendships"."status" in ('pending', 'accepted'))
);
--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "guild_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "dm_key" varchar(80);--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "icon_key" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_key" varchar(64);--> statement-breakpoint
ALTER TABLE "dm_members" ADD CONSTRAINT "dm_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_members" ADD CONSTRAINT "dm_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dm_members_user_id_idx" ON "dm_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_uq" ON "friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" USING btree ("addressee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users" USING btree (lower("username"));--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_dm_key_uq" UNIQUE("dm_key");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_dm_shape_chk" CHECK (("channels"."kind" = 'dm') = ("channels"."guild_id" is null and "channels"."dm_key" is not null));