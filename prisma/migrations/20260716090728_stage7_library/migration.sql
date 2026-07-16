-- CreateEnum
CREATE TYPE "RecordingStage" AS ENUM ('screening', 'theory', 'livecoding', 'soft', 'final');

-- CreateEnum
CREATE TYPE "RecordingDirection" AS ENUM ('ds', 'nlp', 'ai', 'classic_ml');

-- CreateEnum
CREATE TYPE "RecordingGrade" AS ENUM ('junior', 'middle', 'senior');

-- CreateEnum
CREATE TYPE "RecordingOutcome" AS ENUM ('offer', 'reject', 'unknown');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('bigtech', 'fintech', 'product', 'startup');

-- CreateEnum
CREATE TYPE "GuideSection" AS ENUM ('tools', 'resume', 'legend', 'stages', 'ask_interviewer', 'job_search');

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "RecordingStage" NOT NULL,
    "direction" "RecordingDirection" NOT NULL,
    "grade" "RecordingGrade" NOT NULL,
    "outcome" "RecordingOutcome" NOT NULL DEFAULT 'unknown',
    "company_type" "CompanyType" NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "embed_url" TEXT,
    "link_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checklist" JSONB NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "chapters" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_views" (
    "id" TEXT NOT NULL,
    "recording_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guides" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "section" "GuideSection" NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "content_md" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "guide_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recordings_stage_idx" ON "recordings"("stage");

-- CreateIndex
CREATE INDEX "recordings_direction_idx" ON "recordings"("direction");

-- CreateIndex
CREATE INDEX "recordings_status_idx" ON "recordings"("status");

-- CreateIndex
CREATE INDEX "recordings_link_updated_at_idx" ON "recordings"("link_updated_at");

-- CreateIndex
CREATE INDEX "recording_views_recording_id_idx" ON "recording_views"("recording_id");

-- CreateIndex
CREATE INDEX "recording_views_user_id_idx" ON "recording_views"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "guides_slug_key" ON "guides"("slug");

-- CreateIndex
CREATE INDEX "guides_section_order_idx" ON "guides"("section", "order");

-- CreateIndex
CREATE INDEX "guides_status_idx" ON "guides"("status");

-- CreateIndex
CREATE INDEX "bookmarks_guide_id_idx" ON "bookmarks"("guide_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_user_id_guide_id_key" ON "bookmarks"("user_id", "guide_id");

-- AddForeignKey
ALTER TABLE "recording_views" ADD CONSTRAINT "recording_views_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_views" ADD CONSTRAINT "recording_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
