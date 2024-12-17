-- CreateTable
CREATE TABLE "_DepartmentToCustomRole" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "_DepartmentToSystemRole" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_DepartmentToCustomRole_AB_unique" ON "_DepartmentToCustomRole"("A", "B");

-- CreateIndex
CREATE INDEX "_DepartmentToCustomRole_B_index" ON "_DepartmentToCustomRole"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_DepartmentToSystemRole_AB_unique" ON "_DepartmentToSystemRole"("A", "B");

-- CreateIndex
CREATE INDEX "_DepartmentToSystemRole_B_index" ON "_DepartmentToSystemRole"("B");

-- AddForeignKey
ALTER TABLE "_DepartmentToCustomRole" ADD CONSTRAINT "_DepartmentToCustomRole_A_fkey" FOREIGN KEY ("A") REFERENCES "CustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentToCustomRole" ADD CONSTRAINT "_DepartmentToCustomRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentToSystemRole" ADD CONSTRAINT "_DepartmentToSystemRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DepartmentToSystemRole" ADD CONSTRAINT "_DepartmentToSystemRole_B_fkey" FOREIGN KEY ("B") REFERENCES "SystemRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
