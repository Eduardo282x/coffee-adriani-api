-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByHash" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AccountsPayments_methodId_idx" ON "AccountsPayments"("methodId");

-- CreateIndex
CREATE INDEX "Client_blockId_idx" ON "Client"("blockId");

-- CreateIndex
CREATE INDEX "ClientReminder_clientId_idx" ON "ClientReminder"("clientId");

-- CreateIndex
CREATE INDEX "ClientReminder_send_sentAt_idx" ON "ClientReminder"("send", "sentAt");

-- CreateIndex
CREATE INDEX "ClientReminderHistory_clientId_idx" ON "ClientReminderHistory"("clientId");

-- CreateIndex
CREATE INDEX "ErrorMessages_createdAt_idx" ON "ErrorMessages"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorMessages_from_idx" ON "ErrorMessages"("from");

-- CreateIndex
CREATE INDEX "HistoryDolar_date_idx" ON "HistoryDolar"("date");

-- CreateIndex
CREATE INDEX "HistoryInventory_productId_movementDate_idx" ON "HistoryInventory"("productId", "movementDate");

-- CreateIndex
CREATE INDEX "HistoryInventory_movementDate_idx" ON "HistoryInventory"("movementDate");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_productId_key" ON "Inventory"("productId");

-- CreateIndex
-- Reemplaza el indice no unico `[type, period, startDate]`: el unico incluye
-- `status` porque cada ventana tiene legitimamente un corte OPEN y uno CLOSE, y
-- `createCut()` deduplica por `type + period + startDate + status`. Sus columnas
-- iniciales cubren las mismas consultas. Verificado en produccion: 0 duplicados.
CREATE UNIQUE INDEX "InventoryCut_type_period_startDate_status_key" ON "InventoryCut"("type", "period", "startDate", "status");

-- CreateIndex
CREATE INDEX "InventoryCut_status_idx" ON "InventoryCut"("status");

-- CreateIndex
CREATE INDEX "InventoryCutDetail_productId_idx" ON "InventoryCutDetail"("productId");

-- CreateIndex
CREATE INDEX "InventoryEntry_date_idx" ON "InventoryEntry"("date");

-- CreateIndex
CREATE INDEX "InventoryEntry_supplierId_idx" ON "InventoryEntry"("supplierId");

-- CreateIndex
CREATE INDEX "InventoryEntry_status_date_idx" ON "InventoryEntry"("status", "date");

-- CreateIndex
CREATE INDEX "InventoryEntryDetail_productId_idx" ON "InventoryEntryDetail"("productId");

-- CreateIndex
CREATE INDEX "InventoryLoss_productId_date_idx" ON "InventoryLoss"("productId", "date");

-- CreateIndex
CREATE INDEX "Invoice_deleted_dispatchDate_idx" ON "Invoice"("deleted", "dispatchDate");

-- CreateIndex
CREATE INDEX "Invoice_clientId_status_idx" ON "Invoice"("clientId", "status");

-- CreateIndex
CREATE INDEX "Invoice_status_dispatchDate_idx" ON "Invoice"("status", "dispatchDate");

-- CreateIndex
CREATE INDEX "Invoice_sellerId_idx" ON "Invoice"("sellerId");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "InvoicePayment_paymentId_idx" ON "InvoicePayment"("paymentId");

-- CreateIndex
CREATE INDEX "InvoiceProduct_productId_idx" ON "InvoiceProduct"("productId");

-- CreateIndex
CREATE INDEX "Notification_seen_createdAt_idx" ON "Notification"("seen", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_clientId_idx" ON "Notification"("clientId");

-- CreateIndex
CREATE INDEX "Payment_deleted_paymentDate_idx" ON "Payment"("deleted", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_dolarId_idx" ON "Payment"("dolarId");

-- CreateIndex
CREATE INDEX "Users_rolId_idx" ON "Users"("rolId");

-- CreateIndex
CREATE UNIQUE INDEX "Users_username_key" ON "Users"("username");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
