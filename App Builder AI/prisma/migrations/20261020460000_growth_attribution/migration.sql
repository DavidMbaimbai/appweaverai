-- CreateTable
CREATE TABLE "growth_visits" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "referrer_host" TEXT,
    "landing_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_attributions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "visitor_id" TEXT,
    "first_channel" TEXT NOT NULL,
    "first_source" TEXT,
    "first_medium" TEXT,
    "first_campaign" TEXT,
    "first_content" TEXT,
    "first_referrer_host" TEXT,
    "first_landing_path" TEXT,
    "first_at" TIMESTAMP(3) NOT NULL,
    "last_channel" TEXT NOT NULL,
    "last_source" TEXT,
    "last_medium" TEXT,
    "last_campaign" TEXT,
    "last_content" TEXT,
    "last_referrer_host" TEXT,
    "last_landing_path" TEXT,
    "last_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_feature_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "project_key" TEXT NOT NULL DEFAULT '',
    "day" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_feature_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_links" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT,
    "base_url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "content" TEXT,
    "term" TEXT,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "growth_rollups" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "dim_key" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_alerts" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "observed" DOUBLE PRECISION NOT NULL,
    "expected" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_recommendations" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "metric_ids" TEXT[],
    "evidence" JSONB NOT NULL,
    "proposed_action" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "agent_activity_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_visits_created_at_idx" ON "growth_visits"("created_at");

-- CreateIndex
CREATE INDEX "growth_visits_channel_created_at_idx" ON "growth_visits"("channel", "created_at");

-- CreateIndex
CREATE INDEX "growth_visits_visitor_id_idx" ON "growth_visits"("visitor_id");

-- CreateIndex
CREATE UNIQUE INDEX "growth_attributions_user_id_key" ON "growth_attributions"("user_id");

-- CreateIndex
CREATE INDEX "growth_attributions_first_channel_idx" ON "growth_attributions"("first_channel");

-- CreateIndex
CREATE INDEX "growth_attributions_last_channel_idx" ON "growth_attributions"("last_channel");

-- CreateIndex
CREATE INDEX "growth_attributions_created_at_idx" ON "growth_attributions"("created_at");

-- CreateIndex
CREATE INDEX "growth_feature_events_name_created_at_idx" ON "growth_feature_events"("name", "created_at");

-- CreateIndex
CREATE INDEX "growth_feature_events_user_id_created_at_idx" ON "growth_feature_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "growth_feature_events_user_id_name_project_key_day_key" ON "growth_feature_events"("user_id", "name", "project_key", "day");

-- CreateIndex
CREATE INDEX "growth_links_created_at_idx" ON "growth_links"("created_at");

-- CreateIndex
CREATE INDEX "growth_links_campaign_idx" ON "growth_links"("campaign");

-- CreateIndex
CREATE INDEX "growth_rollups_scope_type_scope_id_day_idx" ON "growth_rollups"("scope_type", "scope_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "growth_rollups_scope_type_scope_id_day_dimension_dim_key_me_key" ON "growth_rollups"("scope_type", "scope_id", "day", "dimension", "dim_key", "metric");

-- CreateIndex
CREATE INDEX "growth_alerts_scope_type_scope_id_created_at_idx" ON "growth_alerts"("scope_type", "scope_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "growth_alerts_scope_type_scope_id_metric_day_key" ON "growth_alerts"("scope_type", "scope_id", "metric", "day");

-- CreateIndex
CREATE INDEX "growth_recommendations_scope_type_scope_id_created_at_idx" ON "growth_recommendations"("scope_type", "scope_id", "created_at");
