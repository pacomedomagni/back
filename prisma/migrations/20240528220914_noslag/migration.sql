-- CreateTable
CREATE TABLE "ShopifyCredential" (
    "id" SERIAL NOT NULL,
    "shopName" TEXT NOT NULL,
    "email" TEXT,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,
    "companyId" INTEGER NOT NULL,

    CONSTRAINT "ShopifyCredential_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ShopifyCredential" ADD CONSTRAINT "ShopifyCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyCredential" ADD CONSTRAINT "ShopifyCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;
