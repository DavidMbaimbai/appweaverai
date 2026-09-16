-- AlterTable
ALTER TABLE "users" ADD COLUMN     "low_credits_alert_sent_at" TIMESTAMP(3),
ADD COLUMN     "renewal_reminder_sent_for_end" TIMESTAMP(3),
ADD COLUMN     "subscription_current_period_end" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "feedback_messages_user_id_idx" ON "feedback_messages"("user_id");
