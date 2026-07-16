-- CreateEnum
CREATE TYPE "MockType" AS ENUM ('theory', 'legend');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('open', 'booked', 'closed');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('booked', 'completed', 'cancelled_student', 'cancelled_interviewer', 'no_show');

-- CreateEnum
CREATE TYPE "StrikeReason" AS ENUM ('late_cancel', 'no_show');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('waiting', 'offered', 'expired', 'converted');

-- CreateEnum
CREATE TYPE "AvailabilityExceptionKind" AS ENUM ('day_off', 'extra');

-- CreateEnum
CREATE TYPE "FeedbackVerdict" AS ENUM ('ready', 'needs_work', 'not_ready');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "MockMark" AS ENUM ('answered', 'partial', 'failed');

-- CreateTable
CREATE TABLE "interviewer_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "room_url" TEXT NOT NULL,
    "bio" TEXT,
    "photo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interviewer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" TEXT NOT NULL,
    "interviewer_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" TEXT NOT NULL,
    "interviewer_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "AvailabilityExceptionKind" NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "interviewer_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "MockType" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'booked',
    "cancelled_at" TIMESTAMP(3),
    "notes_draft" TEXT,
    "room_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_strikes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "reason" "StrikeReason" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_strikes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "MockType" NOT NULL,
    "interviewer_id" TEXT,
    "until_date" DATE NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'waiting',
    "offered_slot_id" TEXT,
    "offer_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_templates" (
    "id" TEXT NOT NULL,
    "type" "MockType" NOT NULL,
    "criteria" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubric_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "interviewer_id" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "verdict" "FeedbackVerdict" NOT NULL DEFAULT 'needs_work',
    "strengths" TEXT NOT NULL DEFAULT '',
    "growth" TEXT NOT NULL DEFAULT '',
    "recommended_lesson_ids" JSONB NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_question_marks" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "mark" "MockMark" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_question_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interviewer_profiles_user_id_key" ON "interviewer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "availability_rules_interviewer_id_idx" ON "availability_rules"("interviewer_id");

-- CreateIndex
CREATE INDEX "availability_exceptions_interviewer_id_date_idx" ON "availability_exceptions"("interviewer_id", "date");

-- CreateIndex
CREATE INDEX "slots_starts_at_status_idx" ON "slots"("starts_at", "status");

-- CreateIndex
CREATE INDEX "slots_interviewer_id_idx" ON "slots"("interviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "slots_interviewer_id_starts_at_key" ON "slots"("interviewer_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_slot_id_key" ON "bookings"("slot_id");

-- CreateIndex
CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "booking_strikes_user_id_created_at_idx" ON "booking_strikes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_strikes_booking_id_idx" ON "booking_strikes"("booking_id");

-- CreateIndex
CREATE INDEX "waitlist_user_id_idx" ON "waitlist"("user_id");

-- CreateIndex
CREATE INDEX "waitlist_status_idx" ON "waitlist"("status");

-- CreateIndex
CREATE INDEX "waitlist_interviewer_id_idx" ON "waitlist"("interviewer_id");

-- CreateIndex
CREATE INDEX "waitlist_offered_slot_id_idx" ON "waitlist"("offered_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "rubric_templates_type_key" ON "rubric_templates"("type");

-- CreateIndex
CREATE UNIQUE INDEX "feedbacks_booking_id_key" ON "feedbacks"("booking_id");

-- CreateIndex
CREATE INDEX "feedbacks_interviewer_id_idx" ON "feedbacks"("interviewer_id");

-- CreateIndex
CREATE INDEX "mock_question_marks_question_id_idx" ON "mock_question_marks"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "mock_question_marks_booking_id_question_id_key" ON "mock_question_marks"("booking_id", "question_id");

-- AddForeignKey
ALTER TABLE "interviewer_profiles" ADD CONSTRAINT "interviewer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_strikes" ADD CONSTRAINT "booking_strikes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_strikes" ADD CONSTRAINT "booking_strikes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_offered_slot_id_fkey" FOREIGN KEY ("offered_slot_id") REFERENCES "slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_question_marks" ADD CONSTRAINT "mock_question_marks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_question_marks" ADD CONSTRAINT "mock_question_marks_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
