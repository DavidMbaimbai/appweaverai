-- CreateEnum
CREATE TYPE "SocialInteractionStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PENDING_APPROVAL', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialAudience" AS ENUM ('USER', 'INVESTOR', 'IGNORE');

-- CreateTable
CREATE TABLE "social_interactions" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "reply_to_id" TEXT,
    "author_handle" TEXT NOT NULL,
    "author_name" TEXT,
    "text" TEXT NOT NULL,
    "status" "SocialInteractionStatus" NOT NULL DEFAULT 'RECEIVED',
    "audience" "SocialAudience",
    "confidence" DOUBLE PRECISION,
    "escalate" BOOLEAN NOT NULL DEFAULT false,
    "reply" TEXT,
    "note" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_interactions_status_created_at_idx" ON "social_interactions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_interactions_platform_external_id_key" ON "social_interactions"("platform", "external_id");
