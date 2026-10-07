-- AlterTable
ALTER TABLE "project_github_links" ADD COLUMN "last_synced_commit_sha" TEXT;

-- CreateTable
CREATE TABLE "project_github_synced_files" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "blob_sha" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_github_synced_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_github_synced_files_project_id_path_key" ON "project_github_synced_files"("project_id", "path");

-- AddForeignKey
ALTER TABLE "project_github_synced_files" ADD CONSTRAINT "project_github_synced_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
