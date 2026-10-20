-- CreateEnum
CREATE TYPE "HubInvestorType" AS ENUM ('VC', 'ANGEL', 'FAMILY_OFFICE', 'GRANT', 'ACCELERATOR', 'LENDER', 'OTHER');

-- CreateEnum
CREATE TYPE "HubInvestorStage" AS ENUM ('DISCOVERED', 'RESEARCHED', 'QUALIFIED', 'OUTREACH_DRAFTED', 'CONTACTED', 'REPLIED', 'MEETING_SCHEDULED', 'PITCH_DELIVERED', 'DUE_DILIGENCE', 'NEGOTIATION', 'FUNDING_SECURED', 'DECLINED');

-- CreateEnum
CREATE TYPE "HubOutreachKind" AS ENUM ('EMAIL', 'FOLLOW_UP', 'LINKEDIN', 'CALL_SCRIPT', 'MEETING_REQUEST');

-- CreateEnum
CREATE TYPE "HubOutreachStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "investor_hub_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sector" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT '',
    "amount_sought" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "geography" TEXT NOT NULL DEFAULT '',
    "traction" TEXT NOT NULL DEFAULT '',
    "use_of_funds" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_hub_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_investors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firm" TEXT,
    "type" "HubInvestorType" NOT NULL DEFAULT 'OTHER',
    "website" TEXT,
    "domain" TEXT,
    "email" TEXT,
    "email_key" TEXT,
    "linkedin_url" TEXT,
    "focus" TEXT,
    "sectors" TEXT[],
    "stages" TEXT[],
    "geographies" TEXT[],
    "instruments" TEXT[],
    "ticket_min" INTEGER,
    "ticket_max" INTEGER,
    "portfolio" TEXT[],
    "source_url" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "last_verified_at" TIMESTAMP(3),
    "field_meta" JSONB NOT NULL DEFAULT '{}',
    "pipeline_stage" "HubInvestorStage" NOT NULL DEFAULT 'DISCOVERED',
    "score" INTEGER,
    "score_detail" JSONB,
    "brief" TEXT,
    "brief_sources" JSONB,
    "brief_at" TIMESTAMP(3),
    "tags" TEXT[],
    "opted_out" BOOLEAN NOT NULL DEFAULT false,
    "sequence_active" BOOLEAN NOT NULL DEFAULT true,
    "next_follow_up_at" TIMESTAMP(3),
    "funding_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "funding_amount" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_investors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_investor_activities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_investor_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_investor_outreach" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "kind" "HubOutreachKind" NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "HubOutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_investor_outreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_investor_replies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_investor_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_hub_profiles_user_id_project_id_key" ON "investor_hub_profiles"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "hub_investors_user_id_project_id_pipeline_stage_idx" ON "hub_investors"("user_id", "project_id", "pipeline_stage");

-- CreateIndex
CREATE INDEX "hub_investors_user_id_project_id_next_follow_up_at_idx" ON "hub_investors"("user_id", "project_id", "next_follow_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "hub_investors_project_id_domain_key" ON "hub_investors"("project_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "hub_investors_project_id_email_key_key" ON "hub_investors"("project_id", "email_key");

-- CreateIndex
CREATE INDEX "hub_investor_activities_investor_id_created_at_idx" ON "hub_investor_activities"("investor_id", "created_at");

-- CreateIndex
CREATE INDEX "hub_investor_activities_user_id_project_id_created_at_idx" ON "hub_investor_activities"("user_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "hub_investor_outreach_investor_id_created_at_idx" ON "hub_investor_outreach"("investor_id", "created_at");

-- CreateIndex
CREATE INDEX "hub_investor_outreach_user_id_project_id_status_sent_at_idx" ON "hub_investor_outreach"("user_id", "project_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "hub_investor_replies_investor_id_created_at_idx" ON "hub_investor_replies"("investor_id", "created_at");

-- CreateIndex
CREATE INDEX "hub_investor_replies_user_id_project_id_created_at_idx" ON "hub_investor_replies"("user_id", "project_id", "created_at");

-- AddForeignKey
ALTER TABLE "hub_investor_activities" ADD CONSTRAINT "hub_investor_activities_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "hub_investors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_investor_outreach" ADD CONSTRAINT "hub_investor_outreach_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "hub_investors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_investor_replies" ADD CONSTRAINT "hub_investor_replies_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "hub_investors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
