-- CreateTable
CREATE TABLE "InAppNotifications" (
    "id" SERIAL NOT NULL,
    "read" BOOLEAN DEFAULT false,
    "type" TEXT,
    "delivered" BOOLEAN DEFAULT false,
    "dispatched" BOOLEAN DEFAULT false,
    "content" JSONB,
    "notificationType" "NotificationType" DEFAULT 'SystemNotifications',
    "companyId" INTEGER NOT NULL,
    "receiverId" INTEGER,
    "senderId" INTEGER,
    "salesOrderId" INTEGER,
    "purchaseOrderId" INTEGER,
    "requestId" INTEGER,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "stockRequestId" INTEGER,
    "taskId" INTEGER,

    CONSTRAINT "InAppNotifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InAppNotifications_dispatched_idx" ON "InAppNotifications"("dispatched");

-- CreateIndex
CREATE INDEX "InAppNotifications_delivered_idx" ON "InAppNotifications"("delivered");

-- CreateIndex
CREATE INDEX "InAppNotifications_read_idx" ON "InAppNotifications"("read");

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "AdminCompany"("adminID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotifications" ADD CONSTRAINT "InAppNotifications_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
