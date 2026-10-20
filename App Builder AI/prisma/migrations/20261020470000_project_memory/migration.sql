-- CreateEnum
CREATE TYPE "ProjectMemoryType" AS ENUM ('ARCHITECTURE', 'DECISION', 'BUSINESS_RULE', 'CONVENTION', 'KNOWN_BUG', 'FIXED_BUG', 'FEATURE_STATUS', 'INTEGRATION', 'DESIGN');

-- CreateEnum
CREATE TYPE "ProjectMemorySource" AS ENUM ('AGENT', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProjectMemoryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateTable
CREATE TABLE "project_memories" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "ProjectMemoryType" NOT NULL,
    "title" TEXT NOT NULL,
    "normalized_title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" "ProjectMemorySource" NOT NULL DEFAULT 'AGENT',
    "evidence" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "status" "ProjectMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "feature_state" TEXT,
    "files" TEXT[],
    "superseded_by_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_code_map_entries" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "exports" TEXT[],
    "routes" TEXT[],
    "dependencies" TEXT[],
    "summary_source" TEXT NOT NULL DEFAULT 'STATIC',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_code_map_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_memory_injections" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "request" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "memory_ids" TEXT[],
    "token_estimate" INTEGER NOT NULL,
    "protected_files" TEXT[],
    "unacknowledged" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_memory_injections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_memories_project_id_status_type_idx" ON "project_memories"("project_id", "status", "type");

-- CreateIndex
CREATE INDEX "project_memories_project_id_normalized_title_idx" ON "project_memories"("project_id", "normalized_title");

-- CreateIndex
CREATE INDEX "project_memories_project_id_pinned_idx" ON "project_memories"("project_id", "pinned");

-- CreateIndex
CREATE INDEX "project_code_map_entries_project_id_updated_at_idx" ON "project_code_map_entries"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_code_map_entries_project_id_path_key" ON "project_code_map_entries"("project_id", "path");

-- CreateIndex
CREATE INDEX "project_memory_injections_project_id_created_at_idx" ON "project_memory_injections"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_memories" ADD CONSTRAINT "project_memories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_code_map_entries" ADD CONSTRAINT "project_code_map_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memory_injections" ADD CONSTRAINT "project_memory_injections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
