ALTER TABLE "artifacts" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_project_id_type_key_unique" ON "artifacts" USING btree ("project_id","type","key") WHERE "artifacts"."key" is not null and "artifacts"."deleted_at" is null;