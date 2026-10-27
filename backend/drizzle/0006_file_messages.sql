ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_key" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_mime" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'file' and "messages"."file_key" is not null and char_length("messages"."content") <= 2000));