-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('FULL_TEMPLATE', 'SECTION');

-- CreateEnum
CREATE TYPE "TemplateMarket" AS ENUM ('FREELANCER', 'SMALL_BUSINESS', 'AGENCY', 'SAAS', 'GENERAL');

-- CreateTable
CREATE TABLE "website_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "TemplateKind" NOT NULL,
    "market" "TemplateMarket" NOT NULL DEFAULT 'GENERAL',
    "preview_image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_template_files" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "website_template_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_templates_slug_key" ON "website_templates"("slug");

-- CreateIndex
CREATE INDEX "website_templates_kind_market_sort_order_idx" ON "website_templates"("kind", "market", "sort_order");

-- CreateIndex
CREATE INDEX "website_templates_is_published_idx" ON "website_templates"("is_published");

-- CreateIndex
CREATE UNIQUE INDEX "website_template_files_template_id_path_key" ON "website_template_files"("template_id", "path");

-- AddForeignKey
ALTER TABLE "website_template_files" ADD CONSTRAINT "website_template_files_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "website_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
