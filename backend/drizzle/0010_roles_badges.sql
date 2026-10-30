CREATE TABLE "badges" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"label" varchar(40) NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"description" varchar(120) NOT NULL,
	"requirement" varchar(8) DEFAULT 'manual' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "badges_requirement_chk" CHECK ("badges"."requirement" in ('all', 'admin', 'owner', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"user_id" uuid NOT NULL,
	"badge_id" varchar(32) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" varchar(8) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shown_badges" varchar(32)[] DEFAULT '{}'::varchar[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_owner_uq" ON "users" USING btree ("role") WHERE "users"."role" = 'owner';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_chk" CHECK ("users"."role" in ('owner', 'admin', 'user'));--> statement-breakpoint
INSERT INTO "badges" ("id", "label", "emoji", "description", "requirement", "sort") VALUES
	('owner', 'Owner', '👑', 'Betreiber von disslxt', 'owner', 10),
	('admin', 'Admin', '🛡️', 'Moderiert disslxt', 'admin', 20),
	('member', 'Mitglied', '👋', 'Dabei seit dem Start – für alle', 'all', 30),
	('early-adopter', 'Early Adopter', '🌱', 'Gehörte zu den Ersten auf disslxt', 'manual', 40),
	('supporter', 'Unterstützer', '💚', 'Hat disslxt unterstützt', 'manual', 50);
--> statement-breakpoint
-- The operator accounts so far carried the badge 'admin': the oldest becomes the owner, any
-- others become admins. Their old badge is shown on as a badge of the new kind.
UPDATE "users" SET "role" = 'owner', "shown_badges" = ARRAY['owner']::varchar[]
	WHERE "id" = (SELECT "id" FROM "users" WHERE "badge" = 'admin' ORDER BY "created_at", "id" LIMIT 1);
--> statement-breakpoint
UPDATE "users" SET "role" = 'admin', "shown_badges" = ARRAY['admin']::varchar[]
	WHERE "badge" = 'admin' AND "role" = 'user';
