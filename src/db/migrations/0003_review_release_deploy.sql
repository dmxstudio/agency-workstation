CREATE TYPE "public"."deployment_slot" AS ENUM('production', 'preview');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('building', 'running', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_comment_author_kind" AS ENUM('client', 'team');--> statement-breakpoint
CREATE TYPE "public"."review_comment_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."review_request_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "client_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"release_version" integer NOT NULL,
	"page_key" text,
	"approved_name" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"release_version" integer NOT NULL,
	"slot" "deployment_slot" NOT NULL,
	"status" "deployment_status" DEFAULT 'building' NOT NULL,
	"url" text NOT NULL,
	"detail" jsonb,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"page_key" text NOT NULL,
	"section_id" text,
	"parent_id" text,
	"author_kind" "review_comment_author_kind" NOT NULL,
	"author_name" text NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"status" "review_comment_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"release_version" integer NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"status" "review_request_status" DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_approvals" ADD CONSTRAINT "client_approvals_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_parent_id_review_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."review_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_approvals_request_id_idx" ON "client_approvals" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "deployments_project_id_slot_idx" ON "deployments" USING btree ("project_id","slot");--> statement-breakpoint
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "review_comments_request_id_idx" ON "review_comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "review_comments_parent_id_idx" ON "review_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_token_unique" ON "review_requests" USING btree ("token");--> statement-breakpoint
CREATE INDEX "review_requests_project_id_idx" ON "review_requests" USING btree ("project_id");