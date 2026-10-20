-- CreateTable
CREATE TABLE "launch_kits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "ad_pack" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "build_prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_kits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "launch_kits_user_id_created_at_idx" ON "launch_kits"("user_id", "created_at");
