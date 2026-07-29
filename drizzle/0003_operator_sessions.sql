CREATE TABLE "operator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_id" uuid NOT NULL,
	"mfa_completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_sessions_operator_idx" ON "operator_sessions" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "operator_sessions_expires_idx" ON "operator_sessions" USING btree ("expires_at");