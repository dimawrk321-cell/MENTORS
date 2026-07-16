-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "RecentItemType" AS ENUM ('lesson', 'question', 'guide', 'recording');

-- AlterTable
ALTER TABLE "guides" ADD COLUMN     "search_vector" tsvector;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "search_vector" tsvector;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "search_vector" tsvector;

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "search_vector" tsvector;

-- CreateTable
CREATE TABLE "recent_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_type" "RecentItemType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recent_items_user_id_opened_at_idx" ON "recent_items"("user_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "recent_items_user_id_item_type_entity_id_key" ON "recent_items"("user_id", "item_type", "entity_id");

-- CreateIndex
CREATE INDEX "guides_search_vector_idx" ON "guides" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "guides_title_trgm_idx" ON "guides" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "lessons_search_vector_idx" ON "lessons" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "lessons_title_trgm_idx" ON "lessons" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "questions_search_vector_idx" ON "questions" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "questions_text_trgm_idx" ON "questions" USING GIN ("text_md" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "recordings_search_vector_idx" ON "recordings" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "recordings_title_trgm_idx" ON "recordings" USING GIN ("title" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "recent_items" ADD CONSTRAINT "recent_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Stage 8 (search): FTS trigger functions + triggers + one-time backfill.
-- The functions/triggers below mirror prisma/sql/search-triggers.sql (kept in
-- sync so `prisma db push` test DBs get the same behaviour). Prisma can't
-- express plpgsql triggers, so this raw SQL is appended to the generated diff.
-- ---------------------------------------------------------------------------

-- lessons: title 'A' + content_md 'B'
CREATE OR REPLACE FUNCTION lessons_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('russian', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(NEW.content_md, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lessons_search_vector_trg ON lessons;
CREATE TRIGGER lessons_search_vector_trg
  BEFORE INSERT OR UPDATE OF title, content_md ON lessons
  FOR EACH ROW EXECUTE FUNCTION lessons_search_vector_update();

-- questions: text_md 'A' + answer_md 'B'
CREATE OR REPLACE FUNCTION questions_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('russian', coalesce(NEW.text_md, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(NEW.answer_md, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS questions_search_vector_trg ON questions;
CREATE TRIGGER questions_search_vector_trg
  BEFORE INSERT OR UPDATE OF text_md, answer_md ON questions
  FOR EACH ROW EXECUTE FUNCTION questions_search_vector_update();

-- guides: title 'A' + content_md 'B'
CREATE OR REPLACE FUNCTION guides_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('russian', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(NEW.content_md, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guides_search_vector_trg ON guides;
CREATE TRIGGER guides_search_vector_trg
  BEFORE INSERT OR UPDATE OF title, content_md ON guides
  FOR EACH ROW EXECUTE FUNCTION guides_search_vector_update();

-- recordings: title 'A' (title-only per spec 6)
CREATE OR REPLACE FUNCTION recordings_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('russian', coalesce(NEW.title, '')), 'A');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recordings_search_vector_trg ON recordings;
CREATE TRIGGER recordings_search_vector_trg
  BEFORE INSERT OR UPDATE OF title ON recordings
  FOR EACH ROW EXECUTE FUNCTION recordings_search_vector_update();

-- Backfill existing rows (spec: «Бэкфилл существующих строк в той же миграции»).
UPDATE lessons SET search_vector =
  setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('russian', coalesce(content_md, '')), 'B');
UPDATE questions SET search_vector =
  setweight(to_tsvector('russian', coalesce(text_md, '')), 'A') ||
  setweight(to_tsvector('russian', coalesce(answer_md, '')), 'B');
UPDATE guides SET search_vector =
  setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('russian', coalesce(content_md, '')), 'B');
UPDATE recordings SET search_vector =
  setweight(to_tsvector('russian', coalesce(title, '')), 'A');
