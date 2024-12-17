/*
  Warnings:

  - You are about to drop the column `grossMargin` on the `BatchLog` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "BatchLog" DROP CONSTRAINT "BatchLog_batchId_fkey";

-- DropForeignKey
ALTER TABLE "BatchLog" DROP CONSTRAINT "BatchLog_saleOrderId_fkey";

-- AlterTable
ALTER TABLE "BatchLog" DROP COLUMN "grossMargin",
ADD COLUMN     "supplierId" INTEGER;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
