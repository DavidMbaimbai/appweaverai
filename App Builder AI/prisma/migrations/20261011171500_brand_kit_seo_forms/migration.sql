-- AlterTable
ALTER TABLE "projects"
  ADD COLUMN "seo_title" TEXT,
  ADD COLUMN "seo_description" TEXT,
  ADD COLUMN "seo_image_url" TEXT,
  ADD COLUMN "favicon_url" TEXT;

-- CreateTable
CREATE TABLE "project_brand_kits" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "accent_color" TEXT,
    "font_family" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_form_submissions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "form_name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "visitor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_brand_kits_project_id_key" ON "project_brand_kits"("project_id");

-- CreateIndex
CREATE INDEX "project_form_submissions_project_id_created_at_idx" ON "project_form_submissions"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_brand_kits" ADD CONSTRAINT "project_brand_kits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_form_submissions" ADD CONSTRAINT "project_form_submissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
