/*
  Warnings:

  - The `refresh_token_expires_in` column on the `EbayCredential` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `expires_in` column on the `EbayCredential` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "EbayCredential" DROP COLUMN "refresh_token_expires_in",
ADD COLUMN     "refresh_token_expires_in" TIMESTAMP(3),
DROP COLUMN "expires_in",
ADD COLUMN     "expires_in" TIMESTAMP(3);
