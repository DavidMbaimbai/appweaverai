-- CreateTable
CREATE TABLE "user_saved_sections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_saved_sections_user_id_created_at_idx" ON "user_saved_sections"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_saved_sections" ADD CONSTRAINT "user_saved_sections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
