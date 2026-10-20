-- CreateEnum
CREATE TYPE "ContentRunStatus" AS ENUM ('RUNNING', 'WAITING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "content_pipelines" (
    "id" TEXT NOT NULL,
    "scope" "AgentScopeType" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "project_id" TEXT,
    "owner_user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "time_of_day" TEXT NOT NULL DEFAULT '09:00',
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "posts_per_day" INTEGER NOT NULL DEFAULT 1,
    "platforms" TEXT[],
    "languages" TEXT[],
    "content_types" TEXT[],
    "preferred_post_times" TEXT[],
    "auto_publish_categories" TEXT[],
    "objective" TEXT NOT NULL DEFAULT '',
    "last_run_at" TIMESTAMP(3),
    "max_daily_credits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_runs" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "run_date" TEXT NOT NULL,
    "status" "ContentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "steps" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "locked_until" TIMESTAMP(3),
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_pipelines_scope_key_key" ON "content_pipelines"("scope_key");

-- CreateIndex
CREATE INDEX "content_pipelines_enabled_scope_idx" ON "content_pipelines"("enabled", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "content_runs_pipeline_id_run_date_key" ON "content_runs"("pipeline_id", "run_date");

-- CreateIndex
CREATE INDEX "content_runs_status_updated_at_idx" ON "content_runs"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "content_runs" ADD CONSTRAINT "content_runs_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "content_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
