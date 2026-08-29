ALTER TABLE "lesson_steps"
ADD COLUMN "status" "ContentStatus" NOT NULL DEFAULT 'draft';

UPDATE "lesson_steps"
SET "status" = 'published';
