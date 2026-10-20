-- CreateEnum
CREATE TYPE "AppFeatureStatus" AS ENUM ('PLANNED', 'IMPLEMENTED', 'TESTED', 'DEPLOYED', 'KNOWN_ISSUE');

-- CreateEnum
CREATE TYPE "ProjectIssueStatus" AS ENUM ('OPEN', 'ANALYSING', 'FIX_PROPOSED', 'APPROVED', 'DEPLOYED', 'VERIFIED', 'CLOSED');

-- AlterTable
ALTER TABLE "project_reviews" ADD COLUMN "response_state" TEXT NOT NULL DEFAULT 'READY_FOR_REVIEW',
ADD COLUMN "evidence" JSONB,
ADD COLUMN "draft_original" TEXT,
ADD COLUMN "approved_by_id" TEXT,
ADD COLUMN "approved_at" TIMESTAMP(3),
ADD COLUMN "replied_at" TIMESTAMP(3),
ADD COLUMN "corrections" JSONB;

-- AlterTable
ALTER TABLE "project_review_settings" ADD COLUMN "status_webhook_url" TEXT;

-- CreateTable
CREATE TABLE "admin_access_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_email" TEXT,
    "project_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_features" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "status" "AppFeatureStatus" NOT NULL DEFAULT 'PLANNED',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smoke_checks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "status_code" INTEGER,
    "title" TEXT,
    "version" INTEGER,
    "details" JSONB NOT NULL DEFAULT '[]',
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smoke_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_issues" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "review_id" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" "ProjectIssueStatus" NOT NULL DEFAULT 'OPEN',
    "analysis" TEXT,
    "proposed_plan" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "deployed_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "verified_by_check_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_access_logs_project_id_created_at_idx" ON "admin_access_logs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_access_logs_admin_id_created_at_idx" ON "admin_access_logs"("admin_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_features_project_id_key_key" ON "app_features"("project_id", "key");

-- CreateIndex
CREATE INDEX "app_features_project_id_status_idx" ON "app_features"("project_id", "status");

-- CreateIndex
CREATE INDEX "smoke_checks_project_id_checked_at_idx" ON "smoke_checks"("project_id", "checked_at");

-- CreateIndex
CREATE INDEX "smoke_checks_outcome_checked_at_idx" ON "smoke_checks"("outcome", "checked_at");

-- CreateIndex
CREATE INDEX "project_issues_project_id_status_idx" ON "project_issues"("project_id", "status");

-- CreateIndex
CREATE INDEX "project_issues_review_id_idx" ON "project_issues"("review_id");
