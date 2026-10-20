-- CreateTable
CREATE TABLE "project_subdomains" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_subdomains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_health_checks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status_code" INTEGER,
    "latency_ms" INTEGER,
    "detail" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_subdomains_project_id_key" ON "project_subdomains"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_subdomains_subdomain_key" ON "project_subdomains"("subdomain");

-- CreateIndex
CREATE INDEX "project_health_checks_project_id_checked_at_idx" ON "project_health_checks"("project_id", "checked_at");
