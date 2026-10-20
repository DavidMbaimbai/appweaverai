-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('READY', 'FAILED');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "project_id" TEXT,
    "owner_user_id" TEXT,
    "kind" "MediaKind" NOT NULL,
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'READY',
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "error" TEXT,
    "content_run_id" TEXT,
    "video_job_id" TEXT,
    "linked_type" TEXT,
    "linked_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_key_key" ON "media_assets"("key");

-- CreateIndex
CREATE INDEX "media_assets_scope_key_created_at_idx" ON "media_assets"("scope_key", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_content_run_id_idx" ON "media_assets"("content_run_id");

-- CreateIndex
CREATE INDEX "media_assets_video_job_id_idx" ON "media_assets"("video_job_id");

-- CreateIndex
CREATE INDEX "media_assets_linked_type_linked_id_idx" ON "media_assets"("linked_type", "linked_id");
