CREATE TYPE "public"."throttle_scope" AS ENUM('operator', 'ip');--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"scope" "throttle_scope" NOT NULL,
	"subject" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_scope_subject_pk" PRIMARY KEY("scope","subject")
);
