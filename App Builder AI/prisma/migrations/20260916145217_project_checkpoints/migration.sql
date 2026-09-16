-- CreateTable
CREATE TABLE "project_checkpoints" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "is_automatic" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_checkpoint_files" (
    "id" TEXT NOT NULL,
    "checkpoint_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "project_checkpoint_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_checkpoints_project_id_created_at_idx" ON "project_checkpoints"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_checkpoints_project_id_is_automatic_created_at_idx" ON "project_checkpoints"("project_id", "is_automatic", "created_at");

-- CreateIndex
CREATE INDEX "project_checkpoint_files_checkpoint_id_idx" ON "project_checkpoint_files"("checkpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_checkpoint_files_checkpoint_id_path_key" ON "project_checkpoint_files"("checkpoint_id", "path");

-- AddForeignKey
ALTER TABLE "project_checkpoints" ADD CONSTRAINT "project_checkpoints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_checkpoints" ADD CONSTRAINT "project_checkpoints_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_checkpoint_files" ADD CONSTRAINT "project_checkpoint_files_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "project_checkpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
