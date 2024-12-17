/*
  Warnings:

  - You are about to drop the `ItemGroup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Variance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_ItemGroupToVariance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_ItemToItemGroup` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ItemGroup" DROP CONSTRAINT "ItemGroup_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_groupId_fkey";

-- DropForeignKey
ALTER TABLE "SalesTransaction" DROP CONSTRAINT "SalesTransaction_saleOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Variance" DROP CONSTRAINT "Variance_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Variance" DROP CONSTRAINT "Variance_productId_fkey";

-- DropForeignKey
ALTER TABLE "_ItemGroupToVariance" DROP CONSTRAINT "_ItemGroupToVariance_A_fkey";

-- DropForeignKey
ALTER TABLE "_ItemGroupToVariance" DROP CONSTRAINT "_ItemGroupToVariance_B_fkey";

-- DropForeignKey
ALTER TABLE "_ItemToItemGroup" DROP CONSTRAINT "_ItemToItemGroup_A_fkey";

-- DropForeignKey
ALTER TABLE "_ItemToItemGroup" DROP CONSTRAINT "_ItemToItemGroup_B_fkey";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "salesOrdertId" INTEGER;

-- AlterTable
ALTER TABLE "SalesTransaction" ADD COLUMN     "loanRequestId" INTEGER,
ALTER COLUMN "saleOrderId" DROP NOT NULL;

-- DropTable
DROP TABLE "ItemGroup";

-- DropTable
DROP TABLE "Variance";

-- DropTable
DROP TABLE "_ItemGroupToVariance";

-- DropTable
DROP TABLE "_ItemToItemGroup";

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salesOrdertId_fkey" FOREIGN KEY ("salesOrdertId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTransaction" ADD CONSTRAINT "SalesTransaction_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTransaction" ADD CONSTRAINT "SalesTransaction_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "LoanRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
