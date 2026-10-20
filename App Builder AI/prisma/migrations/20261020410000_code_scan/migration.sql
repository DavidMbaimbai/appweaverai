-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "triggered_by_id" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "source" TEXT NOT NULL DEFAULT 'WORKING',
    "files_scanned" INTEGER NOT NULL DEFAULT 0,
    "critical_count" INTEGER NOT NULL DEFAULT 0,
    "high_count" INTEGER NOT NULL DEFAULT 0,
    "medium_count" INTEGER NOT NULL DEFAULT 0,
    "low_count" INTEGER NOT NULL DEFAULT 0,
    "dep_status" TEXT NOT NULL DEFAULT 'SKIPPED',
    "dep_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_findings" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "snippet" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ack_reason" TEXT,
    "ack_by_id" TEXT,
    "ack_at" TIMESTAMP(3),
    "fix_proposal" TEXT,
    "fix_proposed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_runs_project_id_created_at_idx" ON "scan_runs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "scan_runs_created_at_idx" ON "scan_runs"("created_at");

-- CreateIndex
CREATE INDEX "scan_findings_run_id_severity_idx" ON "scan_findings"("run_id", "severity");

-- CreateIndex
CREATE INDEX "scan_findings_project_id_fingerprint_idx" ON "scan_findings"("project_id", "fingerprint");

-- CreateIndex
CREATE INDEX "scan_findings_project_id_status_idx" ON "scan_findings"("project_id", "status");

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_findings" ADD CONSTRAINT "scan_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
