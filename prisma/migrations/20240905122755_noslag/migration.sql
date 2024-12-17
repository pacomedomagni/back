-- AlterTable
ALTER TABLE "AdminCompany" ADD COLUMN     "VAT" DOUBLE PRECISION NOT NULL DEFAULT 7.5;

-- AlterTable
ALTER TABLE "BatchLog" ADD COLUMN     "grossMargin" INTEGER;

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "initialQtyValue" INTEGER,
ADD COLUMN     "supplierId" INTEGER;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
