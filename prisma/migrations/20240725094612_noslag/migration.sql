-- DropForeignKey
ALTER TABLE "AdjustInventory" DROP CONSTRAINT "AdjustInventory_productId_fkey";

-- CreateTable
CREATE TABLE "_AdjustInventoryToProduct" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_AdjustInventoryToProduct_AB_unique" ON "_AdjustInventoryToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_AdjustInventoryToProduct_B_index" ON "_AdjustInventoryToProduct"("B");

-- AddForeignKey
ALTER TABLE "_AdjustInventoryToProduct" ADD CONSTRAINT "_AdjustInventoryToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "AdjustInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdjustInventoryToProduct" ADD CONSTRAINT "_AdjustInventoryToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
