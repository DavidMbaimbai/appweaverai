-- AlterTable
ALTER TABLE "credit_ledger" ADD COLUMN "source" TEXT,
ADD COLUMN "workspace_id" TEXT;

-- CreateIndex
CREATE INDEX "credit_ledger_workspace_id_created_at_idx" ON "credit_ledger"("workspace_id", "created_at");

-- CreateTable
CREATE TABLE "credit_spend_limits" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "monthly_limit" INTEGER NOT NULL,
    "set_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_spend_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_usage_alerts" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "spent" INTEGER NOT NULL,
    "cap" INTEGER NOT NULL,
    "emailed_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_usage_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_reversals" (
    "id" TEXT NOT NULL,
    "ledger" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_invoices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "number" TEXT,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_due_cents" INTEGER NOT NULL,
    "amount_paid_cents" INTEGER NOT NULL,
    "amount_remaining_cents" INTEGER NOT NULL,
    "hosted_invoice_url" TEXT,
    "invoice_pdf_url" TEXT,
    "billing_reason" TEXT,
    "description" TEXT,
    "plan_id" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_payment_attempt_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "stripe_created_at" TIMESTAMP(3) NOT NULL,
    "last_event_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "plan_id" TEXT,
    "interval" TEXT NOT NULL,
    "interval_count" INTEGER NOT NULL DEFAULT 1,
    "unit_amount_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "mrr_cents" INTEGER NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "current_period_end" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_subscription_mrr_changes" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "user_id" TEXT,
    "plan_id" TEXT,
    "currency" TEXT NOT NULL,
    "mrr_cents" INTEGER NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_subscription_mrr_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_charge_refunds" (
    "charge_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "invoice_id" TEXT,
    "customer_id" TEXT,
    "user_id" TEXT,
    "amount_refunded_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "last_event_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_charge_refunds_pkey" PRIMARY KEY ("charge_id")
);

-- CreateTable
CREATE TABLE "billing_customer_states" (
    "user_id" TEXT NOT NULL,
    "payment_failed_at" TIMESTAMP(3),
    "payment_failed_invoice_id" TEXT,
    "payment_failed_event_at" TIMESTAMP(3),
    "payment_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "invoices_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customer_states_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_spend_limits_scope_scope_id_key" ON "credit_spend_limits"("scope", "scope_id");

-- CreateIndex
CREATE INDEX "credit_usage_alerts_user_id_read_at_created_at_idx" ON "credit_usage_alerts"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_usage_alerts_scope_scope_id_period_threshold_key" ON "credit_usage_alerts"("scope", "scope_id", "period", "threshold");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_reversals_idempotency_key_key" ON "ledger_reversals"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_reversals_ledger_entry_id_key" ON "ledger_reversals"("ledger", "entry_id");

-- CreateIndex
CREATE INDEX "ledger_reversals_user_id_created_at_idx" ON "ledger_reversals"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "stripe_invoices_user_id_stripe_created_at_idx" ON "stripe_invoices"("user_id", "stripe_created_at");

-- CreateIndex
CREATE INDEX "stripe_invoices_status_stripe_created_at_idx" ON "stripe_invoices"("status", "stripe_created_at");

-- CreateIndex
CREATE INDEX "stripe_invoices_customer_id_idx" ON "stripe_invoices"("customer_id");

-- CreateIndex
CREATE INDEX "stripe_subscriptions_status_idx" ON "stripe_subscriptions"("status");

-- CreateIndex
CREATE INDEX "stripe_subscriptions_user_id_idx" ON "stripe_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "stripe_subscriptions_current_period_end_idx" ON "stripe_subscriptions"("current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_subscription_mrr_changes_subscription_id_stripe_even_key" ON "stripe_subscription_mrr_changes"("subscription_id", "stripe_event_id");

-- CreateIndex
CREATE INDEX "stripe_subscription_mrr_changes_subscription_id_effective_a_idx" ON "stripe_subscription_mrr_changes"("subscription_id", "effective_at");

-- CreateIndex
CREATE INDEX "stripe_subscription_mrr_changes_effective_at_idx" ON "stripe_subscription_mrr_changes"("effective_at");

-- CreateIndex
CREATE INDEX "stripe_charge_refunds_user_id_idx" ON "stripe_charge_refunds"("user_id");

-- The development credit ledger is append-only: corrections are compensating entries.
CREATE OR REPLACE FUNCTION credit_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_no_update
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_immutable();
