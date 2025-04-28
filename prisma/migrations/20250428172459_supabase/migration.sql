/*
  Warnings:

  - The values [PENDING,PARTIAL,PAID,CANCELED] on the enum `InvoiceStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `movementDate` on the `Inventory` table. All the data in the column will be lost.
  - You are about to drop the column `movementType` on the `Inventory` table. All the data in the column will be lost.
  - You are about to drop the column `method` on the `Payment` table. All the data in the column will be lost.
  - Added the required column `consignment` to the `Invoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `methodId` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('Creada', 'Pendiente', 'Pagado', 'Vencida', 'Cancelada');
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING ("status"::text::"InvoiceStatus_new");
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "InvoiceStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "HistoryInventory" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Inventory" DROP COLUMN "movementDate",
DROP COLUMN "movementType";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "consignment" BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "method",
ADD COLUMN     "methodId" INTEGER NOT NULL;

-- DropEnum
DROP TYPE "PaymentMethod";

-- CreateTable
CREATE TABLE "HistoryDolar" (
    "id" SERIAL NOT NULL,
    "dolar" DECIMAL(10,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryDolar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
