-- AlterTable
ALTER TABLE "DepartmentRole" ADD COLUMN     "companyId" INTEGER;

-- AddForeignKey
ALTER TABLE "DepartmentRole" ADD CONSTRAINT "DepartmentRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;
