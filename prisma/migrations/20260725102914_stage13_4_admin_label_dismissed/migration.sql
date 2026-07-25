-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dismissed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "admin_label" TEXT;
