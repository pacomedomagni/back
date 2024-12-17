-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ApprovalNotifications', 'SystemNotifications');

-- AlterTable
ALTER TABLE "ApprovalNotifications" ADD COLUMN     "delivered" BOOLEAN DEFAULT false,
ADD COLUMN     "dispatched" BOOLEAN DEFAULT false,
ADD COLUMN     "notificationType" "NotificationType" DEFAULT 'ApprovalNotifications',
ADD COLUMN     "type" TEXT;

-- AlterTable
ALTER TABLE "SystemNotifications" ADD COLUMN     "delivered" BOOLEAN DEFAULT false,
ADD COLUMN     "dispatched" BOOLEAN DEFAULT false,
ADD COLUMN     "notificationType" "NotificationType" DEFAULT 'SystemNotifications',
ADD COLUMN     "type" TEXT;
