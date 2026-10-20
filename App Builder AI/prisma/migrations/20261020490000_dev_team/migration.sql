-- CreateEnum
CREATE TYPE "DevTeamRole" AS ENUM ('ARCHITECT', 'FRONTEND', 'BACKEND', 'DATABASE', 'TESTING', 'SECURITY', 'DEVOPS');

-- CreateEnum
CREATE TYPE "DevTeamRunStatus" AS ENUM ('PLANNING', 'RUNNING', 'NEEDS_DECISION', 'AWAITING_APPROVAL', 'APPLIED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DevTeamTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DevTeamChangeOp" AS ENUM ('CREATE', 'MODIFY', 'DELETE');

-- CreateEnum
CREATE TYPE "DevTeamMergeStatus" AS ENUM ('CLEAN', 'MERGED', 'CONFLICT', 'RESOLVED', 'STALE', 'APPLIED');

-- CreateTable
CREATE TABLE "dev_team_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "artifact_slug" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" "DevTeamRunStatus" NOT NULL DEFAULT 'PLANNING',
    "requested_by_id" TEXT NOT NULL,
    "estimated_credits" INTEGER NOT NULL DEFAULT 0,
    "reserved_credits" INTEGER NOT NULL DEFAULT 0,
    "spent_credits" INTEGER NOT NULL DEFAULT 0,
    "credit_key" TEXT,
    "plan_summary" TEXT,
    "error" TEXT,
    "verification" JSONB,
    "verified_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dev_team_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_team_tasks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" "DevTeamRole" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "DevTeamTaskStatus" NOT NULL DEFAULT 'PENDING',
    "depends_on" TEXT[],
    "input" JSONB,
    "output" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_team_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_team_change_proposals" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "role" "DevTeamRole" NOT NULL,
    "path" TEXT NOT NULL,
    "op" "DevTeamChangeOp" NOT NULL,
    "base_hash" TEXT,
    "base_content" TEXT,
    "proposed_content" TEXT,
    "rationale" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_team_change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_team_messages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "task_id" TEXT,
    "role" "DevTeamRole",
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dev_team_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dev_team_merged_files" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "op" "DevTeamChangeOp" NOT NULL,
    "status" "DevTeamMergeStatus" NOT NULL,
    "base_hash" TEXT,
    "base_content" TEXT,
    "final_content" TEXT,
    "proposal_ids" TEXT[],
    "conflict" JSONB,
    "suggestion" TEXT,
    "resolution" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "dev_team_merged_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dev_team_runs_credit_key_key" ON "dev_team_runs"("credit_key");

-- CreateIndex
CREATE INDEX "dev_team_runs_project_id_created_at_idx" ON "dev_team_runs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "dev_team_runs_status_updated_at_idx" ON "dev_team_runs"("status", "updated_at");

-- CreateIndex
CREATE INDEX "dev_team_tasks_run_id_status_idx" ON "dev_team_tasks"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dev_team_tasks_run_id_key_key" ON "dev_team_tasks"("run_id", "key");

-- CreateIndex
CREATE INDEX "dev_team_change_proposals_run_id_path_idx" ON "dev_team_change_proposals"("run_id", "path");

-- CreateIndex
CREATE INDEX "dev_team_change_proposals_task_id_idx" ON "dev_team_change_proposals"("task_id");

-- CreateIndex
CREATE INDEX "dev_team_messages_run_id_created_at_idx" ON "dev_team_messages"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dev_team_merged_files_run_id_path_key" ON "dev_team_merged_files"("run_id", "path");

-- AddForeignKey
ALTER TABLE "dev_team_tasks" ADD CONSTRAINT "dev_team_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dev_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dev_team_change_proposals" ADD CONSTRAINT "dev_team_change_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dev_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dev_team_change_proposals" ADD CONSTRAINT "dev_team_change_proposals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "dev_team_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dev_team_messages" ADD CONSTRAINT "dev_team_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dev_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dev_team_merged_files" ADD CONSTRAINT "dev_team_merged_files_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dev_team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
