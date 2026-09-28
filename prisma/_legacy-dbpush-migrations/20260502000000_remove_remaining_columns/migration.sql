-- AlterTable
ALTER TABLE "Invoice"
DROP COLUMN IF EXISTS "remaining";

-- AlterTable
ALTER TABLE "Payment"
DROP COLUMN IF EXISTS "remaining";
