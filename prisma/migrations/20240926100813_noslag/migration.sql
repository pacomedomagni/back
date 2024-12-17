-- DropForeignKey
ALTER TABLE "BatchLog" DROP CONSTRAINT "BatchLog_batchId_fkey";

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
