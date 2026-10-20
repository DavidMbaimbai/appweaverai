-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER', 'DESIGNER', 'MARKETER', 'BUSINESS_PARTNER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "BoardTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "BoardLinkKind" AS ENUM ('CHAT_PROMPT', 'CHECKPOINT', 'CAMPAIGN', 'DEPLOYMENT');

-- CreateEnum
CREATE TYPE "TeamApprovalKind" AS ENUM ('PUBLISH', 'MARKETING_CAMPAIGN', 'SPEND', 'OTHER');

-- CreateEnum
CREATE TYPE "TeamApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "team_role_assignments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "assigned_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT,
    "email" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_columns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" TEXT,
    "labels" TEXT[],
    "priority" "BoardTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "due_date" TIMESTAMP(3),
    "sprint" TEXT,
    "position" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_task_comments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "board_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_task_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "kind" "BoardLinkKind" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_approval_requests" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "kind" "TeamApprovalKind" NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "amount_credits" INTEGER,
    "status" "TeamApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_spend_limits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "monthly_limit" INTEGER NOT NULL,
    "set_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_spend_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_usage_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "operation" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "ledger_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_role_assignments_user_id_idx" ON "team_role_assignments"("user_id");

-- CreateIndex
CREATE INDEX "team_role_assignments_project_id_idx" ON "team_role_assignments"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_role_assignments_workspace_id_scope_key_user_id_key" ON "team_role_assignments"("workspace_id", "scope_key", "user_id");

-- CreateIndex
CREATE INDEX "team_invitations_workspace_id_status_idx" ON "team_invitations"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "team_invitations_project_id_status_idx" ON "team_invitations"("project_id", "status");

-- CreateIndex
CREATE INDEX "team_invitations_email_idx" ON "team_invitations"("email");

-- CreateIndex
CREATE INDEX "board_columns_project_id_position_idx" ON "board_columns"("project_id", "position");

-- CreateIndex
CREATE INDEX "board_tasks_project_id_column_id_position_idx" ON "board_tasks"("project_id", "column_id", "position");

-- CreateIndex
CREATE INDEX "board_tasks_project_id_assignee_id_idx" ON "board_tasks"("project_id", "assignee_id");

-- CreateIndex
CREATE INDEX "board_task_comments_task_id_created_at_idx" ON "board_task_comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "board_task_comments_project_id_idx" ON "board_task_comments"("project_id");

-- CreateIndex
CREATE INDEX "board_task_links_project_id_idx" ON "board_task_links"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "board_task_links_task_id_kind_ref_id_key" ON "board_task_links"("task_id", "kind", "ref_id");

-- CreateIndex
CREATE INDEX "team_approval_requests_project_id_status_created_at_idx" ON "team_approval_requests"("project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "user_notifications_user_id_read_at_created_at_idx" ON "user_notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_kind_key" ON "notification_preferences"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "member_spend_limits_workspace_id_user_id_key" ON "member_spend_limits"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_usage_events_ledger_key_key" ON "workspace_usage_events"("ledger_key");

-- CreateIndex
CREATE INDEX "workspace_usage_events_workspace_id_created_at_idx" ON "workspace_usage_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_usage_events_workspace_id_user_id_created_at_idx" ON "workspace_usage_events"("workspace_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "board_tasks" ADD CONSTRAINT "board_tasks_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "board_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_task_comments" ADD CONSTRAINT "board_task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "board_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_task_links" ADD CONSTRAINT "board_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "board_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_approval_requests" ADD CONSTRAINT "team_approval_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "board_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

