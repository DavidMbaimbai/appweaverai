-- CreateTable
CREATE TABLE "project_reviews" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT,
    "body" TEXT NOT NULL,
    "topic" TEXT,
    "sentiment" TEXT,
    "urgency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ai_draft" TEXT,
    "reply" TEXT,
    "reply_status" TEXT NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_review_settings" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_reply_positive" BOOLEAN NOT NULL DEFAULT false,
    "business_info" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "notify_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_review_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_knowledge" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_support_tickets" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "contact" TEXT,
    "transcript" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_reviews_project_id_status_created_at_idx" ON "project_reviews"("project_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_review_settings_project_id_key" ON "project_review_settings"("project_id");

-- CreateIndex
CREATE INDEX "project_knowledge_project_id_created_at_idx" ON "project_knowledge"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_support_tickets_project_id_status_created_at_idx" ON "project_support_tickets"("project_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "project_reviews" ADD CONSTRAINT "project_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_review_settings" ADD CONSTRAINT "project_review_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_knowledge" ADD CONSTRAINT "project_knowledge_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_support_tickets" ADD CONSTRAINT "project_support_tickets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
