-- CreateEnum
CREATE TYPE "AdCreativeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'FAILED');

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "primary_text" TEXT NOT NULL,
    "image_prompt" TEXT NOT NULL,
    "status" "AdCreativeStatus" NOT NULL DEFAULT 'DRAFT',
    "meta_ad_id" TEXT,
    "note" TEXT,
    "spend_cents" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_attributions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_state" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ad_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ad_creatives_status_idx" ON "ad_creatives"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ad_attributions_user_id_key" ON "ad_attributions"("user_id");

-- CreateIndex
CREATE INDEX "ad_attributions_content_idx" ON "ad_attributions"("content");
