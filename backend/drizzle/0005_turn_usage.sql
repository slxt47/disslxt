CREATE TABLE "turn_usage" (
	"month" char(7) PRIMARY KEY NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
