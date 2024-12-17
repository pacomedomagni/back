/*
  Warnings:

  - You are about to drop the column `costPrice` on the `BatchLog` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BatchLog" DROP COLUMN "costPrice",
ADD COLUMN     "costPriceInPCS" DOUBLE PRECISION,
ADD COLUMN     "costPriceInPKT" DOUBLE PRECISION;
