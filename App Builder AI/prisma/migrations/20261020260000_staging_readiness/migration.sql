-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('STAGING', 'PRODUCTION');

-- AlterEnum
ALTER TYPE "ResourceEnvironment" ADD VALUE IF NOT EXISTS 'STAGING';

-- AlterTable: every pre-existing deployment was a production deployment.
ALTER TABLE "deployments"
  ADD COLUMN "environment" "DeploymentEnvironment" NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "access_token" TEXT,
  ADD COLUMN "promoted_from_version" INTEGER;

UPDATE "deployments" SET "environment" = 'PRODUCTION';

-- Make sure the unique indexes below can be created: keep only the newest
-- current production deployment per project.
UPDATE "deployments" d
SET "is_current" = false, "status" = 'SUPERSEDED'
WHERE d."is_current" = true
  AND EXISTS (
    SELECT 1 FROM "deployments" n
    WHERE n."project_id" = d."project_id"
      AND n."is_current" = true
      AND n."version" > d."version"
  );

-- CreateIndex
CREATE INDEX "deployments_project_id_environment_status_idx" ON "deployments"("project_id", "environment", "status");

-- At most one current deployment per environment per project.
-- (isCurrent marks production; the live staging row is the LIVE STAGING row.)
CREATE UNIQUE INDEX "deployments_one_current_production_idx"
  ON "deployments"("project_id") WHERE "is_current" = true AND "environment" = 'PRODUCTION';
CREATE UNIQUE INDEX "deployments_one_current_staging_idx"
  ON "deployments"("project_id") WHERE "status" = 'LIVE' AND "environment" = 'STAGING';

-- CreateTable
CREATE TABLE "launch_reports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "results" JSONB NOT NULL DEFAULT '[]',
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "deployment_version" INTEGER,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "acknowledged_warnings" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "launch_reports_project_id_environment_created_at_idx" ON "launch_reports"("project_id", "environment", "created_at");

-- AddForeignKey
ALTER TABLE "launch_reports" ADD CONSTRAINT "launch_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
