-- CreateEnum
CREATE TYPE "AnnouncementKind" AS ENUM ('banner', 'notification');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "quiet_hours_end" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "quiet_hours_start" TEXT NOT NULL DEFAULT '22:00';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "read_at" TIMESTAMP(3),
    "email_pending" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_at" TIMESTAMP(3),
    "email_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL,
    "inapp" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "kind" "AnnouncementKind" NOT NULL,
    "segment" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_in_app_read_at_idx" ON "notifications"("user_id", "in_app", "read_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_email_pending_scheduled_at_idx" ON "notifications"("email_pending", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_user_id_type_key" ON "notification_prefs"("user_id", "type");

-- CreateIndex
CREATE INDEX "announcements_kind_starts_at_idx" ON "announcements"("kind", "starts_at");

-- CreateIndex
CREATE INDEX "announcements_created_by_idx" ON "announcements"("created_by");

-- CreateIndex
CREATE INDEX "announcement_reads_user_id_idx" ON "announcement_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcement_id_user_id_key" ON "announcement_reads"("announcement_id", "user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
