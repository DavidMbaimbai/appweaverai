-- CreateTable
CREATE TABLE "hub_investor_contacts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "phone" TEXT,
    "timezone" TEXT,
    "sms_consent" BOOLEAN NOT NULL DEFAULT false,
    "sms_consent_at" TIMESTAMP(3),
    "sms_consent_note" TEXT,
    "sms_opted_out" BOOLEAN NOT NULL DEFAULT false,
    "sms_opted_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_investor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_investor_calls" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "called_at" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "next_step" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_investor_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_investor_sms" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_investor_sms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hub_investor_contacts_investor_id_key" ON "hub_investor_contacts"("investor_id");

-- CreateIndex
CREATE INDEX "hub_investor_contacts_phone_idx" ON "hub_investor_contacts"("phone");

-- CreateIndex
CREATE INDEX "hub_investor_contacts_user_id_project_id_idx" ON "hub_investor_contacts"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "hub_investor_calls_investor_id_called_at_idx" ON "hub_investor_calls"("investor_id", "called_at");

-- CreateIndex
CREATE INDEX "hub_investor_calls_user_id_project_id_called_at_idx" ON "hub_investor_calls"("user_id", "project_id", "called_at");

-- CreateIndex
CREATE INDEX "hub_investor_sms_investor_id_created_at_idx" ON "hub_investor_sms"("investor_id", "created_at");

-- CreateIndex
CREATE INDEX "hub_investor_sms_user_id_project_id_created_at_idx" ON "hub_investor_sms"("user_id", "project_id", "created_at");
