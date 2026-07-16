-- Stage 8 (search) — FTS trigger functions + triggers (spec 6 «FTS», 7.11).
--
-- These keep each table's `search_vector` current with a weighted russian
-- tsvector (title/text weight 'A', body weight 'B') so ts_rank ranks title
-- matches above body matches. They are the ONE thing Prisma can't express in
-- schema.prisma, so they live here and are applied in two places:
--   • the stage8_search migration (appended verbatim + a one-time backfill);
--   • tests/global-setup.ts after `prisma db push` (which creates the columns
--     and GIN indexes but not triggers) — via `prisma db execute`.
-- Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS) so re-applying is safe.

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
