-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BACKUP',
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULE',
    "location" TEXT,
    "size_bytes" BIGINT,
    "checksum_sha256" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "retention_deleted" INTEGER NOT NULL DEFAULT 0,
    "row_counts" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_kind_status_finished_at_idx" ON "backup_runs"("kind", "status", "finished_at");
