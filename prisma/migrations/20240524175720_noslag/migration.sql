-- CreateTable
CREATE TABLE "_SalesOrderToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_PurchaseOrderToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_PurchaseOrderConfirmationToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_SalesOrderToProduct_AB_unique" ON "_SalesOrderToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_SalesOrderToProduct_B_index" ON "_SalesOrderToProduct"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_PurchaseOrderToProduct_AB_unique" ON "_PurchaseOrderToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_PurchaseOrderToProduct_B_index" ON "_PurchaseOrderToProduct"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_PurchaseOrderConfirmationToProduct_AB_unique" ON "_PurchaseOrderConfirmationToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_PurchaseOrderConfirmationToProduct_B_index" ON "_PurchaseOrderConfirmationToProduct"("B");

-- AddForeignKey
ALTER TABLE "_SalesOrderToProduct" ADD CONSTRAINT "_SalesOrderToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SalesOrderToProduct" ADD CONSTRAINT "_SalesOrderToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PurchaseOrderToProduct" ADD CONSTRAINT "_PurchaseOrderToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PurchaseOrderToProduct" ADD CONSTRAINT "_PurchaseOrderToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PurchaseOrderConfirmationToProduct" ADD CONSTRAINT "_PurchaseOrderConfirmationToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PurchaseOrderConfirmationToProduct" ADD CONSTRAINT "_PurchaseOrderConfirmationToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "PurchaseOrderConfirmation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
