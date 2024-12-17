-- DropForeignKey
ALTER TABLE "SalesTransaction" DROP CONSTRAINT "SalesTransaction_salesRequestId_fkey";

-- AlterTable
ALTER TABLE "SalesTransaction" ALTER COLUMN "salesRequestId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SalesTransaction" ADD CONSTRAINT "SalesTransaction_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
