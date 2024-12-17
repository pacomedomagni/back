-- AlterTable
ALTER TABLE "PurchaseOrderConfirmation" ADD COLUMN     "purchaseInvoice" TEXT;

-- CreateTable
CREATE TABLE "EbayCredential" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "refresh_token_expires_in" INTEGER,
    "expires_in" INTEGER,
    "token_type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,
    "companyId" INTEGER NOT NULL,

    CONSTRAINT "EbayCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EbayCredential_userId_key" ON "EbayCredential"("userId");

-- AddForeignKey
ALTER TABLE "EbayCredential" ADD CONSTRAINT "EbayCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EbayCredential" ADD CONSTRAINT "EbayCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;
