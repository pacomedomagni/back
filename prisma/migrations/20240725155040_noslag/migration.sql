-- CreateTable
CREATE TABLE "BatchLog" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "status" TEXT,
    "productName" TEXT,
    "rate" DOUBLE PRECISION,
    "warehouseName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" INTEGER,
    "customerId" INTEGER,
    "invoiceId" INTEGER,
    "paymentId" INTEGER,
    "saleOrderId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "warehouseId" INTEGER,

    CONSTRAINT "BatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchLog_batchId_productId_companyId_saleOrderId_idx" ON "BatchLog"("batchId", "productId", "companyId", "saleOrderId");

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WareHouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
