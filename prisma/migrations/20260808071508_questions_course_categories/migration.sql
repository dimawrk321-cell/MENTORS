-- CreateTable
CREATE TABLE "course_question_categories" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_question_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_question_categories_category_id_idx" ON "course_question_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_question_categories_course_id_category_id_key" ON "course_question_categories"("course_id", "category_id");

-- AddForeignKey
ALTER TABLE "course_question_categories" ADD CONSTRAINT "course_question_categories_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_question_categories" ADD CONSTRAINT "course_question_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "question_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
