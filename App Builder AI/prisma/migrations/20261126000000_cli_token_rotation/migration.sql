-- Add expiry to existing access tokens while keeping older tokens valid.
ALTER TABLE "cli_tokens" ADD COLUMN "expires_at" TIMESTAMP(3);

CREATE TABLE "cli_refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_at" TIMESTAMP(3),

    CONSTRAINT "cli_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cli_refresh_tokens_token_hash_key"
  ON "cli_refresh_tokens"("token_hash");
CREATE INDEX "cli_refresh_tokens_user_id_idx"
  ON "cli_refresh_tokens"("user_id");
CREATE INDEX "cli_refresh_tokens_family_id_idx"
  ON "cli_refresh_tokens"("family_id");

ALTER TABLE "cli_refresh_tokens"
  ADD CONSTRAINT "cli_refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
