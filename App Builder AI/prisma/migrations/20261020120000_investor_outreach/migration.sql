-- CreateEnum
CREATE TYPE "InvestorLeadStatus" AS ENUM ('DISCOVERED', 'PENDING_APPROVAL', 'SENDING', 'SENT', 'REJECTED', 'DO_NOT_CONTACT');

-- CreateTable
CREATE TABLE "investor_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firm" TEXT,
    "focus" TEXT,
    "source_url" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" "InvestorLeadStatus" NOT NULL DEFAULT 'DISCOVERED',
    "subject" TEXT,
    "body" TEXT,
    "talking_points" TEXT,
    "note" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_suppressions" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_suppressions_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_leads_email_key" ON "investor_leads"("email");

-- CreateIndex
CREATE INDEX "investor_leads_status_created_at_idx" ON "investor_leads"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "investor_leads_source_url_name_key" ON "investor_leads"("source_url", "name");
