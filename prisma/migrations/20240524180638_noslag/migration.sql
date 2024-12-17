-- CreateTable
CREATE TABLE "_SalesRequestToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_PurchaseRequestToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_SalesRequestToProduct_AB_unique" ON "_SalesRequestToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_SalesRequestToProduct_B_index" ON "_SalesRequestToProduct"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_PurchaseRequestToProduct_AB_unique" ON "_PurchaseRequestToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_PurchaseRequestToProduct_B_index" ON "_PurchaseRequestToProduct"("B");

-- AddForeignKey
ALTER TABLE "_SalesRequestToProduct" ADD CONSTRAINT "_SalesRequestToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SalesRequestToProduct" ADD CONSTRAINT "_SalesRequestToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PurchaseRequestToProduct" ADD CONSTRAINT "_PurchaseRequestToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PurchaseRequestToProduct" ADD CONSTRAINT "_PurchaseRequestToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
