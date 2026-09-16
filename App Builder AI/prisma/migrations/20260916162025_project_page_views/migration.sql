-- CreateTable
CREATE TABLE "project_page_views" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "visitor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_page_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_page_views_project_id_created_at_idx" ON "project_page_views"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_page_views" ADD CONSTRAINT "project_page_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
