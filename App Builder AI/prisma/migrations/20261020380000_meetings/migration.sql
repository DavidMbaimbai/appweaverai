-- CreateTable
CREATE TABLE "meeting_types" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL DEFAULT 'PLATFORM',
    "scope_id" TEXT NOT NULL DEFAULT 'PLATFORM',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 10,
    "location_kind" TEXT NOT NULL DEFAULT 'MANUAL_LINK',
    "required_participants" INTEGER NOT NULL DEFAULT 1,
    "working_hours" JSONB,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "min_notice_min" INTEGER NOT NULL DEFAULT 240,
    "reminder_offsets_min" INTEGER[],
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "autonomous_booking" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL DEFAULT 'PLATFORM',
    "scope_id" TEXT NOT NULL DEFAULT 'PLATFORM',
    "type_id" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "category" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "host_user_id" TEXT,
    "assignee_id" TEXT,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "agenda" TEXT NOT NULL DEFAULT '',
    "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_id" TEXT,
    "requested_by_id" TEXT,
    "requested_by_agent" BOOLEAN NOT NULL DEFAULT false,
    "location_kind" TEXT NOT NULL DEFAULT 'MANUAL_LINK',
    "location_text" TEXT,
    "conference_provider" TEXT,
    "conference_url" TEXT,
    "conference_id" TEXT,
    "calendar_provider" TEXT,
    "external_event_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "internal_notes" TEXT,
    "transcript_consent" BOOLEAN NOT NULL DEFAULT false,
    "transcript" TEXT,
    "outcome" TEXT,
    "next_steps" JSONB,
    "summary" TEXT,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "failure_reason" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "notes_purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_slot_proposals" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposed_by" TEXT NOT NULL DEFAULT 'system',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_slot_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_slot_locks" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "resource_key" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_slot_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_reminders" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "offset_min" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_audits" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_availability_rules" (
    "id" TEXT NOT NULL,
    "resource_key" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "working_hours" JSONB,
    "blocked" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_settings" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "retention_days" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_provider_status" (
    "provider" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_provider_status_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_types_scope_type_scope_id_key_key" ON "meeting_types"("scope_type", "scope_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_idempotency_key_key" ON "meetings"("idempotency_key");

-- CreateIndex
CREATE INDEX "meetings_scope_type_scope_id_status_starts_at_idx" ON "meetings"("scope_type", "scope_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "meetings_source_type_source_id_idx" ON "meetings"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "meetings_starts_at_idx" ON "meetings"("starts_at");

-- CreateIndex
CREATE INDEX "meeting_slot_proposals_meeting_id_status_idx" ON "meeting_slot_proposals"("meeting_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_slot_proposals_meeting_id_starts_at_key" ON "meeting_slot_proposals"("meeting_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_slot_locks_meeting_id_key" ON "meeting_slot_locks"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_slot_locks_resource_key_ends_at_idx" ON "meeting_slot_locks"("resource_key", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_slot_locks_resource_key_starts_at_key" ON "meeting_slot_locks"("resource_key", "starts_at");

-- CreateIndex
CREATE INDEX "meeting_reminders_status_due_at_idx" ON "meeting_reminders"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_reminders_meeting_id_offset_min_channel_key" ON "meeting_reminders"("meeting_id", "offset_min", "channel");

-- CreateIndex
CREATE INDEX "meeting_audits_meeting_id_created_at_idx" ON "meeting_audits"("meeting_id", "created_at");

-- CreateIndex
CREATE INDEX "meeting_notifications_user_id_read_at_created_at_idx" ON "meeting_notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_availability_rules_resource_key_key" ON "meeting_availability_rules"("resource_key");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_settings_scope_key_key" ON "meeting_settings"("scope_key");
