-- CreateEnum
CREATE TYPE "CampaignBilling" AS ENUM ('APPWEAVER_INTERNAL', 'CUSTOMER_MARKETING');

-- CreateEnum
CREATE TYPE "MarketingCreditSource" AS ENUM ('PURCHASED', 'PROMO', 'SUBSCRIPTION', 'REFUND');

-- CreateEnum
CREATE TYPE "MarketingLedgerKind" AS ENUM ('PURCHASE', 'GRANT', 'RESERVE', 'SETTLE', 'RELEASE', 'REFUND', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MarketingReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'REFUNDED');

-- CreateTable
CREATE TABLE "marketing_wallets" (
    "user_id" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "overdraft_limit" INTEGER NOT NULL DEFAULT 0,
    "low_balance_threshold" INTEGER,
    "low_balance_alert_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "marketing_credit_lots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "MarketingCreditSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3),
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_credit_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ledger" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT,
    "project_id" TEXT,
    "kind" "MarketingLedgerKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "operation" TEXT,
    "reservation_id" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "source" "MarketingCreditSource",
    "cost_cents" INTEGER,
    "balance_after" INTEGER NOT NULL,
    "note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_reservations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT,
    "project_id" TEXT,
    "operation" TEXT NOT NULL,
    "billing" "CampaignBilling" NOT NULL DEFAULT 'CUSTOMER_MARKETING',
    "max_credits" INTEGER NOT NULL,
    "settled_credits" INTEGER,
    "status" "MarketingReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotency_key" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_marketing_costs" (
    "id" TEXT NOT NULL,
    "billing" "CampaignBilling" NOT NULL DEFAULT 'APPWEAVER_INTERNAL',
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "estimated_cost_cents" INTEGER NOT NULL,
    "actual_cost_cents" INTEGER,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_marketing_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_price_items" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "credit_cost" INTEGER NOT NULL,
    "rule" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "cost_cents" DOUBLE PRECISION,
    "max_factor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "plan_restrictions" TEXT[],
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "max_per_period" INTEGER,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_price_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "package_id" TEXT,
    "package_name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "stripe_event_id" TEXT,
    "receipt_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_project_budgets" (
    "project_id" TEXT NOT NULL,
    "day_limit" INTEGER,
    "week_limit" INTEGER,
    "month_limit" INTEGER,
    "paused_at" TIMESTAMP(3),
    "paused_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_project_budgets_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "marketing_org_controls" (
    "org_id" TEXT NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "suspended_reason" TEXT,
    "monthly_limit" INTEGER,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_org_controls_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE INDEX "marketing_credit_lots_user_id_remaining_expires_at_idx" ON "marketing_credit_lots"("user_id", "remaining", "expires_at");

-- CreateIndex
CREATE INDEX "marketing_credit_lots_expires_at_idx" ON "marketing_credit_lots"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ledger_idempotency_key_key" ON "marketing_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "marketing_ledger_user_id_created_at_idx" ON "marketing_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_ledger_org_id_created_at_idx" ON "marketing_ledger"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_ledger_project_id_created_at_idx" ON "marketing_ledger"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_ledger_kind_created_at_idx" ON "marketing_ledger"("kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_reservations_idempotency_key_key" ON "marketing_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "marketing_reservations_status_expires_at_idx" ON "marketing_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "marketing_reservations_user_id_status_idx" ON "marketing_reservations"("user_id", "status");

-- CreateIndex
CREATE INDEX "marketing_reservations_project_id_created_at_idx" ON "marketing_reservations"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_marketing_costs_created_at_idx" ON "internal_marketing_costs"("created_at");

-- CreateIndex
CREATE INDEX "internal_marketing_costs_operation_created_at_idx" ON "internal_marketing_costs"("operation", "created_at");

-- CreateIndex
CREATE INDEX "marketing_price_items_operation_effective_from_idx" ON "marketing_price_items"("operation", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_price_items_operation_version_key" ON "marketing_price_items"("operation", "version");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_purchases_stripe_session_id_key" ON "marketing_purchases"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_purchases_payment_intent_id_key" ON "marketing_purchases"("payment_intent_id");

-- CreateIndex
CREATE INDEX "marketing_purchases_user_id_created_at_idx" ON "marketing_purchases"("user_id", "created_at");

-- Ledger rows are immutable: reject any UPDATE or DELETE.
CREATE OR REPLACE FUNCTION marketing_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketing_ledger rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketing_ledger_no_update
  BEFORE UPDATE OR DELETE ON "marketing_ledger"
  FOR EACH ROW EXECUTE FUNCTION marketing_ledger_immutable();
