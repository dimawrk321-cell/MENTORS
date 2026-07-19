-- DropIndex
DROP INDEX "bookings_slot_id_key";

-- CreateIndex
CREATE INDEX "bookings_slot_id_idx" ON "bookings"("slot_id");
