-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('open', 'single', 'multi', 'tf', 'short_text');

-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('import', 'manual');

-- CreateEnum
CREATE TYPE "TestKind" AS ENUM ('module', 'testout');

-- CreateTable
CREATE TABLE "question_categories" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parent_id" TEXT,
    "color_index" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "category_id" TEXT NOT NULL,
    "text_md" TEXT NOT NULL,
    "answer_md" TEXT,
    "explanation_md" TEXT,
    "options" JSONB,
    "accepted_answers" JSONB,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "needs_latex" BOOLEAN NOT NULL DEFAULT false,
    "source" "QuestionSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_lessons" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "is_key" BOOLEAN NOT NULL DEFAULT false,
    "in_quiz" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_tests" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "pool_size" INTEGER NOT NULL DEFAULT 12,
    "threshold" INTEGER NOT NULL DEFAULT 80,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 45,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "kind" "TestKind" NOT NULL DEFAULT 'module',
    "question_ids" JSONB NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_attempt_answers" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_attempt_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_answers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "first" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_categories_slug_key" ON "question_categories"("slug");

-- CreateIndex
CREATE INDEX "question_categories_parent_id_idx" ON "question_categories"("parent_id");

-- CreateIndex
CREATE INDEX "questions_category_id_idx" ON "questions"("category_id");

-- CreateIndex
CREATE INDEX "questions_status_type_idx" ON "questions"("status", "type");

-- CreateIndex
CREATE INDEX "question_lessons_lesson_id_idx" ON "question_lessons"("lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_lessons_question_id_lesson_id_key" ON "question_lessons"("question_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "module_tests_module_id_key" ON "module_tests"("module_id");

-- CreateIndex
CREATE INDEX "test_attempts_user_id_module_id_kind_idx" ON "test_attempts"("user_id", "module_id", "kind");

-- CreateIndex
CREATE INDEX "test_attempt_answers_question_id_idx" ON "test_attempt_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_attempt_answers_attempt_id_question_id_key" ON "test_attempt_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "quiz_answers_user_id_question_id_idx" ON "quiz_answers"("user_id", "question_id");

-- CreateIndex
CREATE INDEX "quiz_answers_lesson_id_idx" ON "quiz_answers"("lesson_id");

-- AddForeignKey
ALTER TABLE "question_categories" ADD CONSTRAINT "question_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "question_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "question_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_lessons" ADD CONSTRAINT "question_lessons_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_lessons" ADD CONSTRAINT "question_lessons_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_tests" ADD CONSTRAINT "module_tests_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempt_answers" ADD CONSTRAINT "test_attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_attempt_answers" ADD CONSTRAINT "test_attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
