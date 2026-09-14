-- AlterTable: allow admins to respond to a feedback message
ALTER TABLE "feedback_messages"
  ADD COLUMN "response" TEXT,
  ADD COLUMN "responded_at" TIMESTAMP(3),
  ADD COLUMN "responded_by" TEXT;
