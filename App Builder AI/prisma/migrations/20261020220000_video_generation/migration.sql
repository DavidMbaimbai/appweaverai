-- CreateEnum
CREATE TYPE "VideoJobMode" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "VideoJobStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VideoProjectKind" AS ENUM ('STANDALONE', 'SERIES');

-- CreateTable
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "provider_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mode" "VideoJobMode" NOT NULL,
    "prompt" TEXT NOT NULL,
    "input_image_key" TEXT,
    "seconds" INTEGER NOT NULL,
    "aspect" TEXT NOT NULL DEFAULT '16:9',
    "status" "VideoJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "external_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "error" TEXT,
    "output_key" TEXT,
    "thumbnail_key" TEXT,
    "estimated_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "actual_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "VideoProjectKind" NOT NULL DEFAULT 'STANDALONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_scenes" (
    "id" TEXT NOT NULL,
    "video_project_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 6,
    "reference_image_key" TEXT,
    "job_id" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_provider_configs" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "models" JSONB NOT NULL DEFAULT '[]',
    "max_seconds_per_job" INTEGER NOT NULL DEFAULT 60,
    "daily_job_limit" INTEGER NOT NULL DEFAULT 100,
    "monthly_budget_cents" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_jobs_idempotency_key_key" ON "video_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "video_jobs_user_id_created_at_idx" ON "video_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "video_jobs_status_next_attempt_at_idx" ON "video_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "video_jobs_provider_id_created_at_idx" ON "video_jobs"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "video_projects_user_id_updated_at_idx" ON "video_projects"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "video_scenes_video_project_id_order_idx" ON "video_scenes"("video_project_id", "order");

-- CreateIndex
CREATE INDEX "video_scenes_job_id_idx" ON "video_scenes"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_provider_configs_provider_id_key" ON "video_provider_configs"("provider_id");

-- AddForeignKey
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "video_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
