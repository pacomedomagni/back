-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "loanRequestId" INTEGER,
ALTER COLUMN "orderNumber" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "LoanRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
