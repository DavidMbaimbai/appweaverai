-- CreateTable
CREATE TABLE "user_github_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "github_username" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "scopes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_github_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_github_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repo_owner" TEXT NOT NULL,
    "repo_name" TEXT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "html_url" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT true,
    "connected_by_id" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "last_synced_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_github_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_github_connections_user_id_key" ON "user_github_connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_github_links_project_id_key" ON "project_github_links"("project_id");

-- AddForeignKey
ALTER TABLE "user_github_connections" ADD CONSTRAINT "user_github_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
