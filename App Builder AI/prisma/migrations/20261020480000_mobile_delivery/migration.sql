-- CreateEnum
CREATE TYPE "MobilePlatform" AS ENUM ('ANDROID', 'IOS', 'PWA');

-- CreateEnum
CREATE TYPE "MobileBuildStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MobileStore" AS ENUM ('GOOGLE_PLAY', 'APP_STORE_CONNECT');

-- CreateTable
CREATE TABLE "mobile_builds" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "artifact_slug" TEXT NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "status" "MobileBuildStatus" NOT NULL,
    "artifact_kind" TEXT NOT NULL,
    "version_name" TEXT NOT NULL,
    "build_number" INTEGER NOT NULL,
    "status_reason" TEXT,
    "logs" TEXT NOT NULL DEFAULT '',
    "readiness_score" INTEGER,
    "artifact_name" TEXT,
    "artifact_size" INTEGER,
    "artifact_sha256" TEXT,
    "artifact_data" BYTEA,
    "external_job_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "mobile_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_store_credentials" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "store" "MobileStore" NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_store_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_store_listings" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "store" "MobileStore" NOT NULL,
    "app_name" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "short_description" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "privacy_url" TEXT NOT NULL DEFAULT '',
    "support_url" TEXT NOT NULL DEFAULT '',
    "age_rating" TEXT NOT NULL DEFAULT '',
    "screenshot_refs" TEXT[],
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_store_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_checklist_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "store" "MobileStore" NOT NULL,
    "item_key" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_builds_project_id_created_at_idx" ON "mobile_builds"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_builds_project_id_platform_build_number_key" ON "mobile_builds"("project_id", "platform", "build_number");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_store_credentials_project_id_store_key" ON "mobile_store_credentials"("project_id", "store");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_store_listings_project_id_store_key" ON "mobile_store_listings"("project_id", "store");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_checklist_items_project_id_store_item_key_key" ON "mobile_checklist_items"("project_id", "store", "item_key");
