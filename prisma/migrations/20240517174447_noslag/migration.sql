/*
  Warnings:

  - You are about to drop the column `content` on the `InAppNotifications` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "InAppNotifications" DROP COLUMN "content",
ADD COLUMN     "message" JSONB;
