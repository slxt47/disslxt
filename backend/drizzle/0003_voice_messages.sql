ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" varchar(16) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio_key" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio_mime" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000));