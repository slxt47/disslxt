ALTER TABLE "channels" DROP CONSTRAINT "channels_dm_shape_chk";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gif_id" varchar(64);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gif_width" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gif_height" integer;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_dm_shape_chk" CHECK (("channels"."kind" in ('dm', 'group')) = ("channels"."guild_id" is null) and ("channels"."kind" = 'dm') = ("channels"."dm_key" is not null));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'file' and "messages"."file_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'gif' and "messages"."gif_id" is not null and char_length("messages"."content") <= 2000));