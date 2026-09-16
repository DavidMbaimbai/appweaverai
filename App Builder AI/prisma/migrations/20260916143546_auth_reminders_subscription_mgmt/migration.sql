-- CreateEnum
CREATE TYPE "AuthReminderKind" AS ENUM ('SIGNUP', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "pending_auth_reminders" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" "AuthReminderKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remind_after" TIMESTAMP(3) NOT NULL,
    "reminder_sent_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "pending_auth_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_auth_reminders_kind_remind_after_reminder_sent_at_r_idx" ON "pending_auth_reminders"("kind", "remind_after", "reminder_sent_at", "resolved_at");

-- CreateIndex
CREATE INDEX "pending_auth_reminders_email_kind_idx" ON "pending_auth_reminders"("email", "kind");
