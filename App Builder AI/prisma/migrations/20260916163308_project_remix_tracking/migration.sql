-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "remixed_from_project_id" TEXT;

-- CreateIndex
CREATE INDEX "projects_remixed_from_project_id_idx" ON "projects"("remixed_from_project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_remixed_from_project_id_fkey" FOREIGN KEY ("remixed_from_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
