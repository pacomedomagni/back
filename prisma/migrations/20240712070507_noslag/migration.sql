/*
  Warnings:

  - You are about to drop the column `accountNumber` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `bankPaymentDate` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `bonuses` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `salary` on the `Employee` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "EbayCredential" ADD COLUMN     "location" TEXT,
ADD COLUMN     "storeName" TEXT;

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "accountNumber",
DROP COLUMN "bankPaymentDate",
DROP COLUMN "bonuses",
DROP COLUMN "salary";
