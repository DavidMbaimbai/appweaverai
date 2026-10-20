-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WEBCHAT', 'EMAIL', 'WHATSAPP', 'SMS', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "external_thread_id" TEXT NOT NULL,
    "contact_ref" TEXT NOT NULL,
    "contact_name" TEXT,
    "lead_id" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" TEXT,
    "human_takeover" BOOLEAN NOT NULL DEFAULT false,
    "is_review" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "category" TEXT,
    "summary" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "provider_message_id" TEXT,
    "delivery_status" "MessageDeliveryStatus",
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "is_draft" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "sources" JSONB,
    "agent_activity_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_connections" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "account_id" TEXT,
    "config" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "scope_type" "AgentScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "contact" TEXT NOT NULL,
    "opt_in" BOOLEAN NOT NULL DEFAULT false,
    "opt_out" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_knowledge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_thread_key" ON "conversations"("scope_type", "scope_id", "channel", "external_thread_id");

-- CreateIndex
CREATE INDEX "conversations_scope_type_scope_id_status_last_message_at_idx" ON "conversations"("scope_type", "scope_id", "status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_messages_channel_provider_message_id_key" ON "inbox_messages"("channel", "provider_message_id");

-- CreateIndex
CREATE INDEX "inbox_messages_conversation_id_created_at_idx" ON "inbox_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_scope_type_scope_id_channel_key" ON "channel_connections"("scope_type", "scope_id", "channel");

-- CreateIndex
CREATE INDEX "channel_connections_channel_account_id_idx" ON "channel_connections"("channel", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_consents_scope_type_scope_id_channel_contact_key" ON "contact_consents"("scope_type", "scope_id", "channel", "contact");

-- CreateIndex
CREATE INDEX "platform_knowledge_created_at_idx" ON "platform_knowledge"("created_at");

-- AddForeignKey
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
