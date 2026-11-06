CREATE TABLE "event_rsvps" (
	"message_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" varchar(8) NOT NULL,
	CONSTRAINT "event_rsvps_message_id_user_id_pk" PRIMARY KEY("message_id","user_id"),
	CONSTRAINT "event_rsvps_answer_chk" CHECK ("event_rsvps"."answer" in ('yes', 'maybe', 'no'))
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"message_id" bigint PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"reminded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"content" text NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_messages_kind_chk" CHECK ("scheduled_messages"."kind" in ('send', 'remind'))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_content_len_chk";--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_message_id_message_events_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message_events"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_events_starts_idx" ON "message_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_send_at_idx" ON "scheduled_messages" USING btree ("send_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_user_idx" ON "scheduled_messages" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_len_chk" CHECK (("messages"."kind" = 'text' and char_length("messages"."content") between 1 and 2000) or ("messages"."kind" = 'voice' and "messages"."audio_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'file' and "messages"."file_key" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'gif' and "messages"."gif_id" is not null and char_length("messages"."content") <= 2000) or ("messages"."kind" = 'join' and "messages"."content" = '') or ("messages"."kind" in ('poll', 'event') and char_length("messages"."content") between 1 and 200));