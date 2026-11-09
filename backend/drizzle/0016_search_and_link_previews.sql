CREATE TABLE "link_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_hash" char(64) NOT NULL,
	"url" text NOT NULL,
	"title" varchar(200),
	"description" varchar(300),
	"site_name" varchar(80),
	"image_key" varchar(64),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_previews_url_uq" UNIQUE("url_hash")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "link_preview_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "preview_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_link_preview_id_link_previews_id_fk" FOREIGN KEY ("link_preview_id") REFERENCES "public"."link_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin (to_tsvector('simple', "content"));