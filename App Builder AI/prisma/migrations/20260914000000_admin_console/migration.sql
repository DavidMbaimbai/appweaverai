-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_VIEWER', 'SECURITY_ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED', 'BANNED');

-- CreateEnum
CREATE TYPE "ProjectAdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_FAILURE', 'LOGIN_SUCCESS', 'BRUTE_FORCE_SUSPECTED', 'UNUSUAL_ACCESS', 'RATE_LIMIT_VIOLATION', 'ACCOUNT_BANNED', 'ACCOUNT_SUSPENDED', 'PAYMENT_ANOMALY', 'ABUSE_SIGNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SecurityEventSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "admin_role" "AdminRole",
ADD COLUMN     "ban_expires_at" TIMESTAMP(3),
ADD COLUMN     "banned_at" TIMESTAMP(3),
ADD COLUMN     "credit_balance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "status_changed_by_id" TEXT,
ADD COLUMN     "status_reason" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "admin_status" "ProjectAdminStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by_id" TEXT,
ADD COLUMN     "suspended_reason" TEXT;

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "admin_email" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL DEFAULT 'INFO',
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "project_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "status" "AiUsageStatus" NOT NULL DEFAULT 'SUCCESS',
    "error_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_adjustments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_flags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT NOT NULL,
    "reviewer_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_flags" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT NOT NULL,
    "reviewer_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "security_events_severity_created_at_idx" ON "security_events"("severity", "created_at");

-- CreateIndex
CREATE INDEX "security_events_type_created_at_idx" ON "security_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "security_events_subject_type_subject_id_idx" ON "security_events"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_project_id_created_at_idx" ON "ai_usage_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_provider_model_created_at_idx" ON "ai_usage_events"("provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "credit_adjustments_user_id_created_at_idx" ON "credit_adjustments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_flags_user_id_status_idx" ON "user_flags"("user_id", "status");

-- CreateIndex
CREATE INDEX "project_flags_project_id_status_idx" ON "project_flags"("project_id", "status");

-- CreateIndex
CREATE INDEX "users_admin_role_idx" ON "users"("admin_role");

-- CreateIndex
CREATE INDEX "users_account_status_idx" ON "users"("account_status");

-- CreateIndex
CREATE INDEX "projects_admin_status_idx" ON "projects"("admin_status");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_flags" ADD CONSTRAINT "user_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_flags" ADD CONSTRAINT "project_flags_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

