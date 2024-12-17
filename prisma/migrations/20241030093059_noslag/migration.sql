/*
  Warnings:

  - You are about to drop the column `salesOrdertId` on the `Payment` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_salesOrdertId_fkey";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "salesOrdertId",
ADD COLUMN     "salesOrderId" INTEGER;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
