/*
  Warnings:

  - You are about to drop the column `amount` on the `BatchLog` table. All the data in the column will be lost.
  - You are about to drop the column `rate` on the `BatchLog` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BatchLog" DROP COLUMN "amount",
DROP COLUMN "rate",
ADD COLUMN     "costPrice" DOUBLE PRECISION,
ADD COLUMN     "sellingPrice" DOUBLE PRECISION;
