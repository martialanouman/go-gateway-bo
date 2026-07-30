ALTER TABLE "operator_sessions" ADD COLUMN "webauthn_challenge" text;--> statement-breakpoint
ALTER TABLE "operator_sessions" ADD COLUMN "webauthn_challenge_expires_at" timestamp with time zone;