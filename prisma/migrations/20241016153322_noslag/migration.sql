/*
  Warnings:

  - You are about to drop the column `purchaseInvoice` on the `LoanReturn` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LoanReturn" DROP COLUMN "purchaseInvoice",
ADD COLUMN     "note" TEXT;
