/*
  Warnings:

  - You are about to drop the column `salesValue` on the `BatchLog` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BatchLog" DROP COLUMN "salesValue",
ADD COLUMN     "amount" DOUBLE PRECISION;
