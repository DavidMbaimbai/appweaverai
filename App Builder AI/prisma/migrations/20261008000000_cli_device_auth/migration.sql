-- CreateEnum
CREATE TYPE "CliDeviceAuthorizationStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateTable
CREATE TABLE "cli_device_authorizations" (
    "id" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "status" "CliDeviceAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "user_id" TEXT,
    "client_name" TEXT,
    "interval" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cli_device_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cli_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "name" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "cli_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cli_device_authorizations_device_code_key" ON "cli_device_authorizations"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "cli_device_authorizations_user_code_key" ON "cli_device_authorizations"("user_code");

-- CreateIndex
CREATE INDEX "cli_device_authorizations_user_id_idx" ON "cli_device_authorizations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cli_tokens_token_hash_key" ON "cli_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "cli_tokens_user_id_idx" ON "cli_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "cli_device_authorizations" ADD CONSTRAINT "cli_device_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
