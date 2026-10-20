-- AlterTable
ALTER TABLE "scan_runs" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SCAN',
ADD COLUMN "regression_status" TEXT,
ADD COLUMN "regression_command" TEXT,
ADD COLUMN "regression_output" TEXT;

-- AlterTable
ALTER TABLE "scan_findings" ADD COLUMN "first_seen_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "scan_schedules" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'WEEKLY',
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_approvals" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCTION_PUBLISH',
    "digest" TEXT NOT NULL,
    "risks" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_diagnoses" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_runs_project_id_kind_created_at_idx" ON "scan_runs"("project_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scan_schedules_project_id_key" ON "scan_schedules"("project_id");

-- CreateIndex
CREATE INDEX "scan_schedules_enabled_next_run_at_idx" ON "scan_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "change_approvals_project_id_status_created_at_idx" ON "change_approvals"("project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "bug_diagnoses_project_id_created_at_idx" ON "bug_diagnoses"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_approvals" ADD CONSTRAINT "change_approvals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_diagnoses" ADD CONSTRAINT "bug_diagnoses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
