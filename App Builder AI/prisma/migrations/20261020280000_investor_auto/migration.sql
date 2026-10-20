-- CreateEnum
CREATE TYPE "InvestorCampaignStatus" AS ENUM ('DRAFT', 'APPROVED', 'RUNNING', 'PAUSED', 'STOPPED', 'DONE');

-- CreateTable
CREATE TABLE "investor_campaigns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "InvestorCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "template_subject" TEXT NOT NULL DEFAULT '',
    "template_body" TEXT NOT NULL DEFAULT '',
    "variants" JSONB NOT NULL DEFAULT '[]',
    "follow_up_body" TEXT NOT NULL DEFAULT '',
    "daily_limit" INTEGER NOT NULL DEFAULT 20,
    "send_window_start" INTEGER NOT NULL DEFAULT 9,
    "send_window_end" INTEGER NOT NULL DEFAULT 17,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "follow_up_days" INTEGER[],
    "max_follow_ups" INTEGER NOT NULL DEFAULT 2,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "paused_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_campaign_targets" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stop_reason" TEXT,
    "steps_sent" INTEGER NOT NULL DEFAULT 0,
    "next_send_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_campaign_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_campaign_sends" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_campaign_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "phone" TEXT,
    "obtained_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_voice_calls" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "to_number" TEXT NOT NULL,
    "from_number" TEXT NOT NULL,
    "transfer_number" TEXT,
    "provider_sid" TEXT,
    "recording" BOOLEAN NOT NULL DEFAULT false,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "outcome" TEXT,
    "transferred" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_voice_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_meeting_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "call_id" TEXT,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_meeting_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investor_campaigns_status_updated_at_idx" ON "investor_campaigns"("status", "updated_at");
CREATE INDEX "investor_campaigns_user_id_project_id_created_at_idx" ON "investor_campaigns"("user_id", "project_id", "created_at");
CREATE UNIQUE INDEX "investor_campaign_targets_campaign_id_investor_id_key" ON "investor_campaign_targets"("campaign_id", "investor_id");
CREATE INDEX "investor_campaign_targets_email_idx" ON "investor_campaign_targets"("email");
CREATE INDEX "investor_campaign_targets_campaign_id_status_next_send_at_idx" ON "investor_campaign_targets"("campaign_id", "status", "next_send_at");
CREATE UNIQUE INDEX "investor_campaign_sends_target_id_step_key" ON "investor_campaign_sends"("target_id", "step");
CREATE INDEX "investor_campaign_sends_campaign_id_created_at_idx" ON "investor_campaign_sends"("campaign_id", "created_at");
CREATE INDEX "investor_consents_investor_id_type_created_at_idx" ON "investor_consents"("investor_id", "type", "created_at");
CREATE INDEX "investor_consents_user_id_project_id_idx" ON "investor_consents"("user_id", "project_id");
CREATE INDEX "investor_voice_calls_investor_id_created_at_idx" ON "investor_voice_calls"("investor_id", "created_at");
CREATE INDEX "investor_voice_calls_user_id_project_id_created_at_idx" ON "investor_voice_calls"("user_id", "project_id", "created_at");
CREATE INDEX "investor_meeting_requests_user_id_project_id_status_idx" ON "investor_meeting_requests"("user_id", "project_id", "status");
CREATE INDEX "investor_meeting_requests_investor_id_idx" ON "investor_meeting_requests"("investor_id");

-- AddForeignKey
ALTER TABLE "investor_campaign_targets" ADD CONSTRAINT "investor_campaign_targets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "investor_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "investor_campaign_sends" ADD CONSTRAINT "investor_campaign_sends_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "investor_campaign_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
