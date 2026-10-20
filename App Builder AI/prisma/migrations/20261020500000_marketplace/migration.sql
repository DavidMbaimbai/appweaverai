-- CreateEnum
CREATE TYPE "MarketplaceAssetType" AS ENUM ('TEMPLATE', 'COMPONENT', 'INTEGRATION', 'WORKFLOW', 'STARTER_KIT');
-- CreateEnum
CREATE TYPE "MarketplaceAssetStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'REMOVED');
-- CreateEnum
CREATE TYPE "MarketplacePayoutStatus" AS ENUM ('NOT_CONFIGURED', 'ONBOARDING', 'ENABLED', 'SUSPENDED');
-- CreateEnum
CREATE TYPE "MarketplaceOrderStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');
-- CreateEnum
CREATE TYPE "MarketplaceLedgerKind" AS ENUM ('EARNING', 'REFUND_REVERSAL', 'PAYOUT', 'ADJUSTMENT');
-- CreateEnum
CREATE TYPE "MarketplaceReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');
-- CreateTable
CREATE TABLE "marketplace_creators" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT,
    "payout_status" "MarketplacePayoutStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "stripe_connect_account_id" TEXT,
    "terms_accepted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_creators_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_assets" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT,
    "is_first_party" BOOLEAN NOT NULL DEFAULT false,
    "type" "MarketplaceAssetType" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[],
    "status" "MarketplaceAssetStatus" NOT NULL DEFAULT 'DRAFT',
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "license" TEXT NOT NULL,
    "published_version" INTEGER,
    "status_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_assets_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_asset_versions" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changelog" TEXT,
    "bundle" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "file_count" INTEGER NOT NULL,
    "status" "MarketplaceAssetStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "scan_verdict" TEXT NOT NULL,
    "scan_findings" JSONB NOT NULL,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_asset_versions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_installs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "artifact_slug" TEXT NOT NULL,
    "target_dir" TEXT NOT NULL,
    "files_written" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_installs_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_reviews" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_reviews_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "status" "MarketplaceOrderStatus" NOT NULL DEFAULT 'PENDING',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "platform_fee_bps" INTEGER,
    "platform_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "creator_share_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "stripe_session_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "stripe_event_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_payout_ledger" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "order_id" TEXT,
    "kind" "MarketplaceLedgerKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_payout_ledger_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "marketplace_reports" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "MarketplaceReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_reports_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_creators_user_id_key" ON "marketplace_creators"("user_id");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_creators_slug_key" ON "marketplace_creators"("slug");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_assets_slug_key" ON "marketplace_assets"("slug");
-- CreateIndex
CREATE INDEX "marketplace_assets_status_type_published_at_idx" ON "marketplace_assets"("status", "type", "published_at");
-- CreateIndex
CREATE INDEX "marketplace_assets_creator_id_status_idx" ON "marketplace_assets"("creator_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_asset_versions_asset_id_version_key" ON "marketplace_asset_versions"("asset_id", "version");
-- CreateIndex
CREATE INDEX "marketplace_installs_user_id_created_at_idx" ON "marketplace_installs"("user_id", "created_at");
-- CreateIndex
CREATE INDEX "marketplace_installs_asset_id_idx" ON "marketplace_installs"("asset_id");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_installs_project_id_asset_id_version_id_key" ON "marketplace_installs"("project_id", "asset_id", "version_id");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_reviews_asset_id_user_id_key" ON "marketplace_reviews"("asset_id", "user_id");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_stripe_session_id_key" ON "marketplace_orders"("stripe_session_id");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_orders_payment_intent_id_key" ON "marketplace_orders"("payment_intent_id");
-- CreateIndex
CREATE INDEX "marketplace_orders_user_id_asset_id_status_idx" ON "marketplace_orders"("user_id", "asset_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_payout_ledger_idempotency_key_key" ON "marketplace_payout_ledger"("idempotency_key");
-- CreateIndex
CREATE INDEX "marketplace_payout_ledger_creator_id_created_at_idx" ON "marketplace_payout_ledger"("creator_id", "created_at");
-- CreateIndex
CREATE INDEX "marketplace_reports_status_created_at_idx" ON "marketplace_reports"("status", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "marketplace_reports_asset_id_reporter_id_key" ON "marketplace_reports"("asset_id", "reporter_id");
-- AddForeignKey
ALTER TABLE "marketplace_assets" ADD CONSTRAINT "marketplace_assets_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "marketplace_creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_asset_versions" ADD CONSTRAINT "marketplace_asset_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "marketplace_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_installs" ADD CONSTRAINT "marketplace_installs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "marketplace_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_installs" ADD CONSTRAINT "marketplace_installs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "marketplace_asset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_reviews" ADD CONSTRAINT "marketplace_reviews_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "marketplace_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "marketplace_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "marketplace_asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_payout_ledger" ADD CONSTRAINT "marketplace_payout_ledger_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "marketplace_creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_payout_ledger" ADD CONSTRAINT "marketplace_payout_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketplace_reports" ADD CONSTRAINT "marketplace_reports_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "marketplace_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Versions are immutable: the content bundle and its checksum can never change after insert.
CREATE OR REPLACE FUNCTION marketplace_version_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."bundle" IS DISTINCT FROM OLD."bundle"
     OR NEW."checksum" IS DISTINCT FROM OLD."checksum"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."asset_id" IS DISTINCT FROM OLD."asset_id" THEN
    RAISE EXCEPTION 'marketplace_asset_versions content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketplace_asset_versions_immutable
BEFORE UPDATE ON "marketplace_asset_versions"
FOR EACH ROW EXECUTE FUNCTION marketplace_version_immutable();
