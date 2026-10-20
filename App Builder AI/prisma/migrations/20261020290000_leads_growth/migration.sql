-- AlterTable
ALTER TABLE "project_page_views" ADD COLUMN "utm" JSONB;

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "utm" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "score" INTEGER,
    "score_reasons" JSONB,
    "scored_at" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "consent_text" TEXT,
    "consent_at" TIMESTAMP(3),
    "opted_out" BOOLEAN NOT NULL DEFAULT false,
    "form_submission_id" TEXT,
    "suggested_action" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_email_drafts" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_email_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_availability_slots" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_bookings" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_experiments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "bottleneck" TEXT NOT NULL,
    "proposed_action" JSONB NOT NULL,
    "estimated_cost_cents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "metric_before" JSONB,
    "metric_after" JSONB,
    "result_note" TEXT,
    "execution_result" JSONB,
    "window_days" INTEGER NOT NULL DEFAULT 14,
    "approved_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "measured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_form_submission_id_key" ON "leads"("form_submission_id");
CREATE UNIQUE INDEX "leads_project_id_email_key" ON "leads"("project_id", "email");
CREATE INDEX "leads_project_id_status_idx" ON "leads"("project_id", "status");
CREATE INDEX "leads_project_id_created_at_idx" ON "leads"("project_id", "created_at");
CREATE INDEX "lead_activities_lead_id_created_at_idx" ON "lead_activities"("lead_id", "created_at");
CREATE INDEX "lead_follow_ups_done_at_due_at_idx" ON "lead_follow_ups"("done_at", "due_at");
CREATE INDEX "lead_follow_ups_lead_id_idx" ON "lead_follow_ups"("lead_id");
CREATE INDEX "lead_email_drafts_lead_id_status_idx" ON "lead_email_drafts"("lead_id", "status");
CREATE INDEX "lead_availability_slots_project_id_starts_at_idx" ON "lead_availability_slots"("project_id", "starts_at");
CREATE UNIQUE INDEX "lead_bookings_slot_id_key" ON "lead_bookings"("slot_id");
CREATE INDEX "lead_bookings_lead_id_idx" ON "lead_bookings"("lead_id");
CREATE INDEX "growth_experiments_project_id_status_idx" ON "growth_experiments"("project_id", "status");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_email_drafts" ADD CONSTRAINT "lead_email_drafts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_availability_slots" ADD CONSTRAINT "lead_availability_slots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_bookings" ADD CONSTRAINT "lead_bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "lead_availability_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_bookings" ADD CONSTRAINT "lead_bookings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "growth_experiments" ADD CONSTRAINT "growth_experiments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
