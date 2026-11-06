CREATE TABLE "channel_roles" (
	"channel_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "channel_roles_channel_id_role_id_pk" PRIMARY KEY("channel_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "guild_bans" (
	"guild_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"banned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_bans_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "guild_member_roles" (
	"guild_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "guild_member_roles_guild_id_user_id_role_id_pk" PRIMARY KEY("guild_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "guild_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"color" char(7),
	"permissions" varchar(32)[] DEFAULT '{}'::varchar[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_roles_guild_name_uq" UNIQUE("guild_id","name")
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_roles" ADD CONSTRAINT "channel_roles_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_roles" ADD CONSTRAINT "channel_roles_role_id_guild_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."guild_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bans" ADD CONSTRAINT "guild_bans_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bans" ADD CONSTRAINT "guild_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bans" ADD CONSTRAINT "guild_bans_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_member_roles" ADD CONSTRAINT "guild_member_roles_role_id_guild_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."guild_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_member_roles" ADD CONSTRAINT "guild_member_roles_guild_id_user_id_guild_members_guild_id_user_id_fk" FOREIGN KEY ("guild_id","user_id") REFERENCES "public"."guild_members"("guild_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_roles" ADD CONSTRAINT "guild_roles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_roles_role_idx" ON "channel_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "guild_member_roles_role_idx" ON "guild_member_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "guild_member_roles_user_idx" ON "guild_member_roles" USING btree ("user_id");