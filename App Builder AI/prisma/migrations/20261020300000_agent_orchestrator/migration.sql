-- CreateEnum
CREATE TYPE "AgentScopeType" AS ENUM ('PLATFORM', 'PROJECT');

-- CreateEnum
CREATE TYPE "OrchestratorAgent" AS ENUM ('MARKETING_DIRECTOR', 'CONTENT', 'SOCIAL_MANAGER', 'CUSTOMER_ENGAGEMENT', 'INVESTOR', 'VOICE_MESSAGING', 'GROWTH_ANALYST');

-- CreateEnum
CREATE TYPE "AgentMode" AS ENUM ('ASSIST', 'APPROVAL', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AgentActivityStatus" AS ENUM ('PLANNED', 'AWAITING_APPROVAL', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED');

-- CreateTable
CREATE TABLE "agent_settings" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "agent" "OrchestratorAgent" NOT NULL,
    "mode" "AgentMode" NOT NULL DEFAULT 'ASSIST',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "daily_action_limit" INTEGER NOT NULL DEFAULT 20,
    "daily_budget_cents" INTEGER NOT NULL DEFAULT 0,
    "authorised_by" TEXT,
    "authorised_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_activities" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "agent" "OrchestratorAgent" NOT NULL,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "risk" TEXT NOT NULL DEFAULT 'LOW',
    "status" "AgentActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "sources" JSONB,
    "tool" TEXT,
    "input_summary" TEXT,
    "payload" JSONB,
    "result_summary" TEXT,
    "decision_reason" TEXT,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "credits_charged" INTEGER,
    "error" TEXT,
    "retry_of" TEXT,
    "idempotency_key" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_kill_switches" (
    "scope" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_kill_switches_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_settings_scope_type_scope_id_agent_key" ON "agent_settings"("scope_type", "scope_id", "agent");

-- CreateIndex
CREATE UNIQUE INDEX "agent_activities_idempotency_key_key" ON "agent_activities"("idempotency_key");

-- CreateIndex
CREATE INDEX "agent_activities_scope_type_scope_id_created_at_idx" ON "agent_activities"("scope_type", "scope_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_activities_status_created_at_idx" ON "agent_activities"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_activities_agent_created_at_idx" ON "agent_activities"("agent", "created_at");
