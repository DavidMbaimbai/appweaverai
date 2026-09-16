-- CreateTable
CREATE TABLE "project_custom_domains" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_custom_domains_project_id_key" ON "project_custom_domains"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_custom_domains_domain_key" ON "project_custom_domains"("domain");

-- AddForeignKey
ALTER TABLE "project_custom_domains" ADD CONSTRAINT "project_custom_domains_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
