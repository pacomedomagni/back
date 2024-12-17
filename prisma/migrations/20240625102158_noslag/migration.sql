-- CreateTable
CREATE TABLE "_SystemRoleToCompany" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_SystemRoleToCompany_AB_unique" ON "_SystemRoleToCompany"("A", "B");

-- CreateIndex
CREATE INDEX "_SystemRoleToCompany_B_index" ON "_SystemRoleToCompany"("B");

-- AddForeignKey
ALTER TABLE "_SystemRoleToCompany" ADD CONSTRAINT "_SystemRoleToCompany_A_fkey" FOREIGN KEY ("A") REFERENCES "AdminCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SystemRoleToCompany" ADD CONSTRAINT "_SystemRoleToCompany_B_fkey" FOREIGN KEY ("B") REFERENCES "SystemRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
