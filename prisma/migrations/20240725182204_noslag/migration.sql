/*
  Warnings:

  - Added the required column `batchNumber` to the `BatchLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BatchLog" ADD COLUMN     "batchNumber" TEXT NOT NULL;
