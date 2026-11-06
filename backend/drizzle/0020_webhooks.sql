CREATE TABLE "channel_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "bot_name" varchar(32);--> statement-breakpoint
ALTER TABLE "channel_webhooks" ADD CONSTRAINT "channel_webhooks_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_webhooks" ADD CONSTRAINT "channel_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_webhooks_channel_idx" ON "channel_webhooks" USING btree ("channel_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'file' and "messages"."file_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'gif' and "messages"."gif_id" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'join' and "messages"."content" = '') or ("messages"."kind" in ('poll', 'event') and char_length("messages"."content") between 1 and 200) or ("messages"."kind" = 'bot' and char_length("messages"."content") between 1 and 2000));