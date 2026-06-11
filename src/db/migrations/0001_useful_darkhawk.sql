CREATE TYPE "public"."generation_kind" AS ENUM('generate', 'regenerate');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('success', 'conflicts', 'error');--> statement-breakpoint
CREATE TABLE "generations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" "generation_kind" NOT NULL,
	"status" "generation_status" NOT NULL,
	"summary" jsonb NOT NULL,
	"error" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_project_id_created_at_idx" ON "generations" USING btree ("project_id","created_at");