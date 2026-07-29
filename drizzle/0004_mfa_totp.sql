ALTER TYPE "public"."throttle_scope" ADD VALUE 'mfa';--> statement-breakpoint
CREATE TABLE "operator_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "mfa_totp_activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "mfa_totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "operator_recovery_codes" ADD CONSTRAINT "operator_recovery_codes_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_recovery_codes_operator_hash_idx" ON "operator_recovery_codes" USING btree ("operator_id","code_hash");