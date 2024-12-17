/*
  Warnings:

  - You are about to drop the `Item` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_ItemToStock` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_productId_fkey";

-- DropForeignKey
ALTER TABLE "_ItemToStock" DROP CONSTRAINT "_ItemToStock_A_fkey";

-- DropForeignKey
ALTER TABLE "_ItemToStock" DROP CONSTRAINT "_ItemToStock_B_fkey";

-- DropTable
DROP TABLE "Item";

-- DropTable
DROP TABLE "_ItemToStock";
