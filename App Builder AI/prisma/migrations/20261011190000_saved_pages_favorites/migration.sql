-- CreateTable
CREATE TABLE "user_saved_pages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_template_favorites" (
    "user_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_template_favorites_pkey" PRIMARY KEY ("user_id", "template_id")
);

-- CreateIndex
CREATE INDEX "user_saved_pages_user_id_created_at_idx" ON "user_saved_pages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_saved_pages" ADD CONSTRAINT "user_saved_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_template_favorites" ADD CONSTRAINT "user_template_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_template_favorites" ADD CONSTRAINT "user_template_favorites_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "website_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
