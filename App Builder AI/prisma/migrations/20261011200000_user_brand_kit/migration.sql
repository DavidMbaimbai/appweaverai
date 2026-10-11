-- CreateTable
CREATE TABLE "user_brand_kits" (
    "user_id" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "accent_color" TEXT,
    "font_family" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_brand_kits_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_brand_kits" ADD CONSTRAINT "user_brand_kits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
