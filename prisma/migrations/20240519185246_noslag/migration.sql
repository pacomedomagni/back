/*
  Warnings:

  - You are about to drop the column `weekWorked` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `weeklyFloat` on the `Employee` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "weekWorked",
DROP COLUMN "weeklyFloat";
