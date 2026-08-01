-- CreateEnum
CREATE TYPE "CourseUnlockSource" AS ENUM ('system', 'admin');

-- CreateTable
CREATE TABLE "course_access" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "unlocked_at" TIMESTAMP(3),
    "unlocked_by" "CourseUnlockSource",
    "locked_by_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_access_course_id_idx" ON "course_access"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_access_user_id_course_id_key" ON "course_access"("user_id", "course_id");

-- AddForeignKey
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
