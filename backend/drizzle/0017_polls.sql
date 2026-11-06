CREATE TABLE "poll_votes" (
	"message_id" bigint NOT NULL,
	"option" integer NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "poll_votes_message_id_option_user_id_pk" PRIMARY KEY("message_id","option","user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"message_id" bigint PRIMARY KEY NOT NULL,
	"options" varchar(80)[] NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_message_id_polls_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."polls"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_votes_user_idx" ON "poll_votes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'file' and "messages"."file_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'gif' and "messages"."gif_id" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'join' and "messages"."content" = '') or ("messages"."kind" = 'poll' and char_length("messages"."content") between 1 and 200));