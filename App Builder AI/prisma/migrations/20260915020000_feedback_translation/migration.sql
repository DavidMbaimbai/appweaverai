-- Add language/translation support to feedback_messages so non-English
-- messages are auto-translated for admins, and admin replies are
-- auto-translated back into the user's original language.
ALTER TABLE "feedback_messages" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "feedback_messages" ADD COLUMN IF NOT EXISTS "translated_message" TEXT;
ALTER TABLE "feedback_messages" ADD COLUMN IF NOT EXISTS "translated_response" TEXT;
