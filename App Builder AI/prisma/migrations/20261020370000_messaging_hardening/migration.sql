-- CreateTable
CREATE TABLE "message_status_events" (
    "id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_suppressions" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "contact" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_proofs" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "contact" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "proof" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_verifications" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "detail" TEXT,
    "error_code" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_status_events_channel_provider_message_id_idx" ON "message_status_events"("channel", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_status_events_channel_event_id_key" ON "message_status_events"("channel", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_suppressions_scope_type_scope_id_channel_contact_key" ON "messaging_suppressions"("scope_type", "scope_id", "channel", "contact");

-- CreateIndex
CREATE INDEX "consent_proofs_scope_type_scope_id_channel_contact_idx" ON "consent_proofs"("scope_type", "scope_id", "channel", "contact");

-- CreateIndex
CREATE UNIQUE INDEX "channel_verifications_scope_type_scope_id_channel_key" ON "channel_verifications"("scope_type", "scope_id", "channel");
