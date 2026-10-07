-- CreateEnum
CREATE TYPE "AgentToolRiskLevel" AS ENUM ('SAFE', 'REVIEW', 'DESTRUCTIVE');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXECUTED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "risk_level" "AgentToolRiskLevel" NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_tool_calls_conversation_id_created_at_idx" ON "agent_tool_calls"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_tool_calls_project_id_idx" ON "agent_tool_calls"("project_id");

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
