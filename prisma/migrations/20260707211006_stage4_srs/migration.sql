-- CreateEnum
CREATE TYPE "SrsGrade" AS ENUM ('again', 'hard', 'good');

-- CreateEnum
CREATE TYPE "SrsAddedFrom" AS ENUM ('lesson_key', 'test_fail', 'quiz_fail', 'mock', 'manual');

-- CreateTable
CREATE TABLE "srs_cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "next_review_at" DATE NOT NULL,
    "added_from" "SrsAddedFrom" NOT NULL,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "reviews_count" INTEGER NOT NULL DEFAULT 0,
    "last_grade" "SrsGrade",
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "srs_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "srs_reviews" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "grade" "SrsGrade" NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prev_step" INTEGER NOT NULL,
    "new_step" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "srs_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "srs_cards_user_id_next_review_at_idx" ON "srs_cards"("user_id", "next_review_at");

-- CreateIndex
CREATE INDEX "srs_cards_question_id_idx" ON "srs_cards"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "srs_cards_user_id_question_id_key" ON "srs_cards"("user_id", "question_id");

-- CreateIndex
CREATE INDEX "srs_reviews_card_id_reviewed_at_idx" ON "srs_reviews"("card_id", "reviewed_at");

-- AddForeignKey
ALTER TABLE "srs_cards" ADD CONSTRAINT "srs_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_cards" ADD CONSTRAINT "srs_cards_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_reviews" ADD CONSTRAINT "srs_reviews_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "srs_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
