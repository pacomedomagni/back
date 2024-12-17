/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `ShopifyCredential` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ShopifyCredential_userId_key" ON "ShopifyCredential"("userId");
