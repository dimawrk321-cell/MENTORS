-- Pilot «Понятный путь»: explicit lesson-path policy and honest duration parts.
-- Existing lessons keep the current serial video+text behaviour through `combined`.
CREATE TYPE "LessonPathPolicy" AS ENUM ('combined', 'choose_one', 'video_only', 'text_only');
CREATE TYPE "LessonPathSelection" AS ENUM ('video', 'text');

ALTER TABLE "lessons"
  ADD COLUMN "path_policy" "LessonPathPolicy" NOT NULL DEFAULT 'combined',
  ADD COLUMN "text_minutes" INTEGER,
  ADD COLUMN "video_minutes" INTEGER,
  ADD COLUMN "practice_minutes" INTEGER;

ALTER TABLE "lesson_progress"
  ADD COLUMN "selected_path" "LessonPathSelection";
