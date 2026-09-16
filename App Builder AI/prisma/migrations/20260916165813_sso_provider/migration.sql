-- CreateTable
CREATE TABLE "sso_providers" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "user_id" TEXT,
    "provider_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "domain" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_providers_provider_id_key" ON "sso_providers"("provider_id");

-- CreateIndex
CREATE INDEX "sso_providers_domain_idx" ON "sso_providers"("domain");

-- AddForeignKey
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
