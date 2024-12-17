-- CreateTable
CREATE TABLE "LoanReturn" (
    "id" SERIAL NOT NULL,
    "loanId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "itemDetails" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "customerId" INTEGER,
    "purchaseInvoice" TEXT,

    CONSTRAINT "LoanReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LoanRequestToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_LoanRequestToProduct_AB_unique" ON "_LoanRequestToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_LoanRequestToProduct_B_index" ON "_LoanRequestToProduct"("B");

-- AddForeignKey
ALTER TABLE "LoanReturn" ADD CONSTRAINT "LoanReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanReturn" ADD CONSTRAINT "LoanReturn_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "LoanRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanReturn" ADD CONSTRAINT "LoanReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanReturn" ADD CONSTRAINT "LoanReturn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WareHouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LoanRequestToProduct" ADD CONSTRAINT "_LoanRequestToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "LoanReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LoanRequestToProduct" ADD CONSTRAINT "_LoanRequestToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
