CREATE TYPE "public"."alert_evaluation_owner" AS ENUM('alertmanager', 'bff');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."alert_scope" AS ENUM('global', 'connector', 'account');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."notification_source" AS ENUM('alertmanager', 'bff_evaluator', 'billing_alert_stream');--> statement-breakpoint
CREATE TYPE "public"."operator_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."permission_category" AS ENUM('routing', 'connectors', 'sessions', 'antispam', 'accounts', 'billing', 'content', 'compliance', 'alerts', 'audit', 'admin');--> statement-breakpoint
CREATE TYPE "public"."saved_view_type" AS ENUM('cdr_search', 'traffic_dashboard');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"metric" text NOT NULL,
	"scope" "alert_scope" DEFAULT 'global' NOT NULL,
	"scope_id" text,
	"evaluation_owner" "alert_evaluation_owner" NOT NULL,
	"condition_json" jsonb NOT NULL,
	"notify_channels_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "alert_rule_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"alert_rule_id" uuid,
	"source" "notification_source" NOT NULL,
	"severity" "notification_severity" NOT NULL,
	"message" text NOT NULL,
	"read_by_operators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"operator_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_id_created_at_pk" PRIMARY KEY("id","created_at")
)
-- Seule retouche manuelle de ce fichier généré : Drizzle ne sait pas déclarer une table
-- partitionnée. Le reste de la mécanique — partitions, partition par défaut, fonction de
-- maintenance — vit dans la migration 0001, écrite entièrement à la main.
--
-- La clé primaire est déjà composite `(id, created_at)` : PostgreSQL exige que la clé de
-- partitionnement figure dans toute contrainte d'unicité. Elle est déclarée ainsi dans le schéma
-- TypeScript, pas rattrapée ici — sinon le typage mentirait sur la vraie contrainte.
PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "operator_roles" (
	"operator_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "operator_roles_operator_id_role_id_pk" PRIMARY KEY("operator_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"mfa_totp_secret" text,
	"mfa_webauthn_credentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "operator_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"category" "permission_category" NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_id" uuid NOT NULL,
	"view_type" "saved_view_type" NOT NULL,
	"name" text NOT NULL,
	"filters_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_roles" ADD CONSTRAINT "operator_roles_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_roles" ADD CONSTRAINT "operator_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_scope_idx" ON "alert_rules" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_operator_idx" ON "audit_log" USING btree ("operator_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operators_status_idx" ON "operators" USING btree ("status");--> statement-breakpoint
CREATE INDEX "saved_views_operator_idx" ON "saved_views" USING btree ("operator_id","view_type");