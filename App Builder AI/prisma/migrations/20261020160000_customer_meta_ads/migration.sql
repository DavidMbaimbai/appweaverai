-- CreateTable
CREATE TABLE "meta_ad_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "ad_account_id" TEXT,
    "ad_account_name" TEXT,
    "currency" TEXT,
    "page_id" TEXT,
    "page_name" TEXT,
    "daily_cap_cents" INTEGER NOT NULL DEFAULT 500,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "primary_text" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "daily_cents" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "meta_ad_id" TEXT,
    "meta_campaign_id" TEXT,
    "spend_cents" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_connections_user_id_key" ON "meta_ad_connections"("user_id");

-- CreateIndex
CREATE INDEX "customer_ads_user_id_created_at_idx" ON "customer_ads"("user_id", "created_at");
