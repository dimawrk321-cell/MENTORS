-- A lesson may remain legacy (zero rows here), so existing lessons keep their
-- current UI until a mentor explicitly splits one into steps.
CREATE TABLE "lesson_steps" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "content_md" TEXT NOT NULL DEFAULT '',
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lesson_step_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'in_progress',
    "completed_at" TIMESTAMP(3),
    "scroll_pos" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_step_progress_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "question_lessons" ADD COLUMN "step_id" TEXT;

CREATE UNIQUE INDEX "lesson_steps_lesson_id_order_key" ON "lesson_steps"("lesson_id", "order");
CREATE INDEX "lesson_steps_lesson_id_idx" ON "lesson_steps"("lesson_id");
CREATE UNIQUE INDEX "lesson_step_progress_user_id_step_id_key" ON "lesson_step_progress"("user_id", "step_id");
CREATE INDEX "lesson_step_progress_step_id_idx" ON "lesson_step_progress"("step_id");
CREATE INDEX "question_lessons_step_id_idx" ON "question_lessons"("step_id");

ALTER TABLE "lesson_steps" ADD CONSTRAINT "lesson_steps_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_step_progress" ADD CONSTRAINT "lesson_step_progress_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_step_progress" ADD CONSTRAINT "lesson_step_progress_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "lesson_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_lessons" ADD CONSTRAINT "question_lessons_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "lesson_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
