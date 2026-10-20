-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_enc" TEXT NOT NULL,
    "masked_hints" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "health_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_latency_ms" INTEGER,
    "last_test_error" TEXT,
    "last_used_at" TIMESTAMP(3),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "est_cost_micros" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_health_checks" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_catalogue_overrides" (
    "integration_id" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_catalogue_overrides_pkey" PRIMARY KEY ("integration_id")
);

-- CreateTable
CREATE TABLE "integration_api_logs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "response_bytes" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_events" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_integration_id_health_status_idx" ON "integration_connections"("integration_id", "health_status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_project_id_integration_id_key" ON "integration_connections"("project_id", "integration_id");

-- CreateIndex
CREATE INDEX "integration_health_checks_connection_id_created_at_idx" ON "integration_health_checks"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_health_checks_created_at_idx" ON "integration_health_checks"("created_at");

-- CreateIndex
CREATE INDEX "integration_api_logs_project_id_created_at_idx" ON "integration_api_logs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_api_logs_connection_id_created_at_idx" ON "integration_api_logs"("connection_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_endpoints_public_id_key" ON "inbound_webhook_endpoints"("public_id");

-- CreateIndex
CREATE INDEX "inbound_webhook_endpoints_project_id_idx" ON "inbound_webhook_endpoints"("project_id");

-- CreateIndex
CREATE INDEX "inbound_webhook_events_endpoint_id_received_at_idx" ON "inbound_webhook_events"("endpoint_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_events_endpoint_id_event_id_key" ON "inbound_webhook_events"("endpoint_id", "event_id");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_project_id_idx" ON "webhook_subscriptions"("project_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_project_id_created_at_idx" ON "webhook_deliveries"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_health_checks" ADD CONSTRAINT "integration_health_checks_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_api_logs" ADD CONSTRAINT "integration_api_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_api_logs" ADD CONSTRAINT "integration_api_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_webhook_endpoints" ADD CONSTRAINT "inbound_webhook_endpoints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_webhook_events" ADD CONSTRAINT "inbound_webhook_events_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "inbound_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
