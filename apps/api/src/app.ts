import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import googleAuthRoutes from "./routes/googleAuth.js";
import groupRoutes from "./routes/groups.js";
import pumpRoutes from "./routes/pumps.js";
import itemRoutes from "./routes/items.js";
import customerRoutes from "./routes/customers.js";
import vehicleRoutes from "./routes/vehicles.js";
import pendingTransactionRoutes from "./routes/pendingTransactions.js";
import billRoutes from "./routes/bills.js";
import stockRoutes from "./routes/stock.js";
import purchaseRoutes from "./routes/purchases.js";
import rateChangeRoutes from "./routes/rateChanges.js";
import receiptRoutes from "./routes/receipts.js";
import reportRoutes from "./routes/reports.js";
import tenantRoutes from "./routes/tenant.js";
import settingsRoutes from "./routes/settings.js";
import shiftRoutes from "./routes/shifts.js";
import auditLogRoutes from "./routes/auditLogs.js";
import finYearRoutes from "./routes/finYear.js";
import backupRoutes from "./routes/backup.js";
import dataResetRoutes from "./routes/dataReset.js";
import userRoutes from "./routes/users.js";
import orderRoutes from "./routes/orders.js";
import customerAuthRoutes from "./routes/customerAuth.js";
import customerOrderRoutes from "./routes/customerOrders.js";
import communicationRoutes from "./routes/communication.js";
import publicInvoiceRoutes from "./routes/publicInvoice.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(authPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(googleAuthRoutes);
  await app.register(groupRoutes);
  await app.register(pumpRoutes);
  await app.register(itemRoutes);
  await app.register(customerRoutes);
  await app.register(vehicleRoutes);
  await app.register(pendingTransactionRoutes);
  await app.register(billRoutes);
  await app.register(stockRoutes);
  await app.register(purchaseRoutes);
  await app.register(rateChangeRoutes);
  await app.register(receiptRoutes);
  await app.register(reportRoutes);
  await app.register(tenantRoutes);
  await app.register(settingsRoutes);
  await app.register(shiftRoutes);
  await app.register(auditLogRoutes);
  await app.register(finYearRoutes);
  await app.register(backupRoutes);
  await app.register(dataResetRoutes);
  await app.register(userRoutes);
  await app.register(orderRoutes);
  await app.register(customerAuthRoutes);
  await app.register(customerOrderRoutes);
  await app.register(communicationRoutes);
  await app.register(publicInvoiceRoutes);

  return app;
}
