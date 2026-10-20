-- AlterEnum
ALTER TYPE "MarketingPlatform" ADD VALUE IF NOT EXISTS 'YOUTUBE';

-- CreateEnum
CREATE TYPE "VideoReleasePlatform" AS ENUM ('YOUTUBE', 'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'TIKTOK');

-- CreateEnum
CREATE TYPE "VideoReleaseStatus" AS ENUM ('DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'MANUAL', 'CANCELLED', 'PAUSED');

-- CreateTable
CREATE TABLE "video_releases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "video_project_id" TEXT,
    "scene_id" TEXT,
    "job_id" TEXT NOT NULL,
    "platform" "VideoReleasePlatform" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[],
    "thumbnail_key" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "VideoReleaseStatus" NOT NULL DEFAULT 'SCHEDULED',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "external_id" TEXT,
    "post_url" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "error" TEXT,
    "note" TEXT,
    "published_at" TIMESTAMP(3),
    "season" INTEGER,
    "episode" INTEGER,
    "series_key" TEXT,
    "metrics" JSONB,
    "metrics_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "outcome_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_releases_idempotency_key_key" ON "video_releases"("idempotency_key");

-- CreateIndex
CREATE INDEX "video_releases_status_scheduled_at_idx" ON "video_releases"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "video_releases_user_id_scheduled_at_idx" ON "video_releases"("user_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "video_releases_user_id_series_key_idx" ON "video_releases"("user_id", "series_key");

-- CreateIndex
CREATE INDEX "video_releases_job_id_idx" ON "video_releases"("job_id");
