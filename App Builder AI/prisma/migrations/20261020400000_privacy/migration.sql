-- CreateTable
CREATE TABLE "privacy_export_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "storage_key" TEXT,
    "data" BYTEA,
    "size_bytes" INTEGER,
    "error" TEXT,
    "download_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "privacy_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_deletion_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',

    CONSTRAINT "privacy_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "requester_name" TEXT,
    "email" TEXT,
    "email_hash" TEXT,
    "phone" TEXT,
    "phone_hash" TEXT,
    "details" TEXT,
    "verify_token_hash" TEXT,
    "verify_expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "outcome" TEXT,
    "outcome_note" TEXT,
    "handled_by_id" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_retention_policies" (
    "key" TEXT NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_run_count" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "privacy_retention_policies_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "privacy_export_jobs_user_id_created_at_idx" ON "privacy_export_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "privacy_export_jobs_status_expires_at_idx" ON "privacy_export_jobs"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_deletion_requests_user_id_key" ON "privacy_deletion_requests"("user_id");

-- CreateIndex
CREATE INDEX "privacy_deletion_requests_status_scheduled_for_idx" ON "privacy_deletion_requests"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_requests_verify_token_hash_key" ON "privacy_requests"("verify_token_hash");

-- CreateIndex
CREATE INDEX "privacy_requests_status_due_at_idx" ON "privacy_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "privacy_requests_email_hash_idx" ON "privacy_requests"("email_hash");

-- CreateIndex
CREATE INDEX "privacy_request_events_request_id_created_at_idx" ON "privacy_request_events"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "privacy_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

