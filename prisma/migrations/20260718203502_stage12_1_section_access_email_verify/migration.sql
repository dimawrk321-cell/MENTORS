-- CreateEnum
CREATE TYPE "ReadingFontSize" AS ENUM ('s', 'm', 'l');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "guides_legend_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guides_resume_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reading_font_size" "ReadingFontSize" NOT NULL DEFAULT 'm';

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_verifications_user_id_idx" ON "email_verifications"("user_id");

-- AddForeignKey
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data-fix (spec 12.1/C3): the new columns default to false for NEW students, but
-- existing active/invited students must keep access to Резюме/Легенда they already
-- had (these sections lived under /guides, ungated, until now). library_enabled is
-- intentionally left untouched.
UPDATE "users"
SET "guides_resume_enabled" = true, "guides_legend_enabled" = true
WHERE "role" = 'student' AND "status" IN ('active', 'invited');
