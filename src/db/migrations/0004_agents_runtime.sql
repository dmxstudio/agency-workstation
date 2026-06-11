CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'proposed', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('anthropic', 'openai', 'mock');--> statement-breakpoint
CREATE TABLE "workspace_llm_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"label" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"last4" text NOT NULL,
	"created_by" text NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
-- agent_runs was a minimal placeholder until this migration (no production
-- data; nothing in the app ever inserted rows). Clearing it makes the new
-- NOT NULL columns and the text -> enum conversion safe on any dev DB.
DELETE FROM "agent_runs";--> statement-breakpoint
-- Drop the text default BEFORE the type change; re-add it as enum after.
ALTER TABLE "agent_runs" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "status" SET DATA TYPE "public"."agent_run_status" USING "status"::"public"."agent_run_status";--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."agent_run_status";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "workspace_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "skill_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "target_artifact_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "target_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "target_key" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "instruction" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "input_artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "provider" "llm_provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "key_ref" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "validations" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "result_version" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "proposed_by_run_id" text;--> statement-breakpoint
ALTER TABLE "workspace_llm_keys" ADD CONSTRAINT "workspace_llm_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_llm_keys" ADD CONSTRAINT "workspace_llm_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_llm_keys_workspace_id_idx" ON "workspace_llm_keys" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_target_artifact_id_artifacts_id_fk" FOREIGN KEY ("target_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_key_ref_workspace_llm_keys_id_fk" FOREIGN KEY ("key_ref") REFERENCES "public"."workspace_llm_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_proposed_by_run_id_agent_runs_id_fk" FOREIGN KEY ("proposed_by_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_id_created_at_idx" ON "agent_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_target_artifact_id_idx" ON "agent_runs" USING btree ("target_artifact_id");