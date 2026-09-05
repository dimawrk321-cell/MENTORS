CREATE TYPE "StudySessionStatus" AS ENUM ('draft', 'running', 'reflection', 'completed', 'abandoned');
CREATE TABLE "study_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "active_user_id" TEXT,
  "course_id" TEXT,
  "lesson_id" TEXT,
  "course_title" TEXT,
  "lesson_title" TEXT,
  "timezone" TEXT NOT NULL,
  "status" "StudySessionStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 0,
  "fields" JSONB NOT NULL,
  "planned_at" TIMESTAMP(3) NOT NULL,
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "repetitions" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "study_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "study_sessions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "study_sessions_active_user_id_key" ON "study_sessions"("active_user_id");
CREATE INDEX "study_sessions_user_id_created_at_idx" ON "study_sessions"("user_id", "created_at");
CREATE INDEX "study_sessions_user_id_completed_at_idx" ON "study_sessions"("user_id", "completed_at");
CREATE INDEX "study_sessions_lesson_id_idx" ON "study_sessions"("lesson_id");
CREATE INDEX "study_sessions_course_id_idx" ON "study_sessions"("course_id");
