CREATE TABLE "channel_reads" (
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_reads_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "invite_max_uses" integer;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "invite_uses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" bigint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_reads_channel_idx" ON "channel_reads" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_reply_to_idx" ON "messages" USING btree ("reply_to_id") WHERE "messages"."reply_to_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_pinned_idx" ON "messages" USING btree ("channel_id") WHERE "messages"."pinned_at" is not null;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'file' and "messages"."file_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'gif' and "messages"."gif_id" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'join' and "messages"."content" = ''));--> statement-breakpoint
-- Unread counters start now: what already exists counts as read for everyone.
INSERT INTO "channel_reads" ("user_id", "channel_id", "last_read_id")
SELECT gm."user_id", c."id", max(m."id")
FROM "messages" m
JOIN "channels" c ON c."id" = m."channel_id"
JOIN "guild_members" gm ON gm."guild_id" = c."guild_id"
GROUP BY gm."user_id", c."id"
UNION ALL
SELECT dm."user_id", dm."channel_id", max(m."id")
FROM "messages" m
JOIN "dm_members" dm ON dm."channel_id" = m."channel_id"
GROUP BY dm."user_id", dm."channel_id";
