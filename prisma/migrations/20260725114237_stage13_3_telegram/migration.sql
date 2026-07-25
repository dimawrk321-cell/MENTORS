-- AlterTable
ALTER TABLE "notification_prefs" ADD COLUMN     "telegram" BOOLEAN;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "telegram_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegram_sent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_user_id_key" ON "telegram_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_code_key" ON "telegram_link_codes"("code");

-- CreateIndex
CREATE INDEX "telegram_link_codes_user_id_idx" ON "telegram_link_codes"("user_id");

-- CreateIndex
CREATE INDEX "notifications_telegram_pending_scheduled_at_idx" ON "notifications"("telegram_pending", "scheduled_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_telegram_sent_at_idx" ON "notifications"("user_id", "telegram_sent_at");

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
