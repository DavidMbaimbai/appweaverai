-- CreateEnum
CREATE TYPE "MarketingPlatform" AS ENUM ('X', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK');

-- CreateEnum
CREATE TYPE "ProjectCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ProjectPostStatus" AS ENUM ('DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'MANUAL');

-- CreateTable
CREATE TABLE "social_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "MarketingPlatform" NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "expires_at" TIMESTAMP(3),
    "account_name" TEXT,
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_campaigns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    "status" "ProjectCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_posts" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "platform" "MarketingPlatform" NOT NULL,
    "text" TEXT NOT NULL,
    "image_url" TEXT,
    "hashtags" TEXT[],
    "scheduled_at" TIMESTAMP(3),
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "ProjectPostStatus" NOT NULL DEFAULT 'DRAFT',
    "external_id" TEXT,
    "error" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_user_id_platform_key" ON "social_connections"("user_id", "platform");

-- CreateIndex
CREATE INDEX "project_campaigns_project_id_created_at_idx" ON "project_campaigns"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_campaigns_user_id_idx" ON "project_campaigns"("user_id");

-- CreateIndex
CREATE INDEX "project_posts_status_scheduled_at_idx" ON "project_posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "project_posts_campaign_id_idx" ON "project_posts"("campaign_id");

-- AddForeignKey
ALTER TABLE "project_posts" ADD CONSTRAINT "project_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "project_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
