-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refresh_token_enc" TEXT,
    "access_token_enc" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "scopes" TEXT NOT NULL DEFAULT '',
    "account_label" TEXT,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "working_hours" JSONB,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 0,
    "min_notice_min" INTEGER NOT NULL DEFAULT 120,
    "slot_step_min" INTEGER NOT NULL DEFAULT 30,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_oauth_states" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "code_verifier_enc" TEXT NOT NULL,
    "return_to" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_booking_syncs" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_MANUAL_CONFIRMATION',
    "external_event_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "retry_create" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_booking_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_scope_key_key" ON "calendar_connections"("scope_key");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_oauth_states_state_hash_key" ON "calendar_oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "calendar_oauth_states_expires_at_idx" ON "calendar_oauth_states"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_booking_syncs_booking_id_key" ON "calendar_booking_syncs"("booking_id");

-- CreateIndex
CREATE INDEX "calendar_booking_syncs_scope_key_status_idx" ON "calendar_booking_syncs"("scope_key", "status");

-- CreateIndex
CREATE INDEX "calendar_booking_syncs_retry_create_status_idx" ON "calendar_booking_syncs"("retry_create", "status");
