/*
  Warnings:

  - You are about to drop the `EbayCredential` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ShopifyCredential` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('SHOPIFY', 'EBAY');

-- DropForeignKey
ALTER TABLE "EbayCredential" DROP CONSTRAINT "EbayCredential_companyId_fkey";

-- DropForeignKey
ALTER TABLE "EbayCredential" DROP CONSTRAINT "EbayCredential_userId_fkey";

-- DropForeignKey
ALTER TABLE "ShopifyCredential" DROP CONSTRAINT "ShopifyCredential_companyId_fkey";

-- DropForeignKey
ALTER TABLE "ShopifyCredential" DROP CONSTRAINT "ShopifyCredential_userId_fkey";

-- DropTable
DROP TABLE "EbayCredential";

-- DropTable
DROP TABLE "ShopifyCredential";

-- CreateTable
CREATE TABLE "Integration" (
    "id" SERIAL NOT NULL,
    "integrationType" "IntegrationType" NOT NULL,
    "credentials" JSONB NOT NULL,
    "location" TEXT,
    "storeName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;
