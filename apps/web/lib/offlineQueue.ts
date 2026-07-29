import { api, ApiError } from "./api";

const DB_NAME = "petropro-offline";
const STORE_NAME = "pending-outbox";
const BILLS_STORE_NAME = "queued-bills";
// Bumped from 1 -> 2 to add BILLS_STORE_NAME alongside the original pending-transactions outbox
// — onupgradeneeded below only creates whichever store is still missing, so existing installs
// keep their queued pending-transaction entries across the upgrade.
const DB_VERSION = 2;

export interface QueuedEntry {
  clientRef: string;
  vehicle_no: string;
  item_code: string;
  qty?: number;
  amount?: number;
  odometer?: number;
  pump_code?: string;
  queuedAt: string;
}

/** A full walk-in bill queued while offline — same shape as api.createWalkInBill's body, plus
 *  the client-generated idempotency key and when it was queued. */
export interface QueuedBill {
  clientRef: string;
  paymentType: string;
  customerCode?: string;
  vehicleNo?: string;
  orderNo?: string;
  pumpCode?: string;
  lines: { item_code: string; qty: number; odometer?: number; odometerOpening?: number; orderLineId?: number }[];
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "clientRef" });
      }
      if (!db.objectStoreNames.contains(BILLS_STORE_NAME)) {
        db.createObjectStore(BILLS_STORE_NAME, { keyPath: "clientRef" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueEntry(entry: QueuedEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedEntries(): Promise<QueuedEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedEntry[]);
    req.onerror = () => reject(req.error);
  });
}

async function removeQueuedEntry(clientRef: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(clientRef);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Drains the offline outbox against the API. `client_ref` makes each submission idempotent
 * (see routes/pendingTransactions.ts), so a flush that partially succeeds and gets interrupted
 * is safe to retry from scratch. A request that fails with an ApiError (the server was reachable
 * and rejected it — bad data, auth, etc.) is dropped rather than retried forever; anything else
 * (network failure) is left queued for the next attempt.
 */
export async function flushQueue(token: string): Promise<{ synced: number; remaining: number }> {
  const entries = await getQueuedEntries();
  let synced = 0;

  for (const entry of entries) {
    try {
      await api.createPendingTransaction(token, {
        vehicle_no: entry.vehicle_no,
        item_code: entry.item_code,
        qty: entry.qty,
        amount: entry.amount,
        odometer: entry.odometer,
        pump_code: entry.pump_code,
        client_ref: entry.clientRef,
      });
      await removeQueuedEntry(entry.clientRef);
      synced++;
    } catch (err) {
      if (err instanceof ApiError) {
        await removeQueuedEntry(entry.clientRef);
      }
      // else: still unreachable — leave queued for the next flush attempt
    }
  }

  const remaining = (await getQueuedEntries()).length;
  return { synced, remaining };
}

export async function queueBill(bill: QueuedBill): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BILLS_STORE_NAME, "readwrite");
    tx.objectStore(BILLS_STORE_NAME).put(bill);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedBills(): Promise<QueuedBill[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BILLS_STORE_NAME, "readonly");
    const req = tx.objectStore(BILLS_STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedBill[]);
    req.onerror = () => reject(req.error);
  });
}

async function removeQueuedBill(clientRef: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BILLS_STORE_NAME, "readwrite");
    tx.objectStore(BILLS_STORE_NAME).delete(clientRef);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Same shape/semantics as flushQueue() above, but for full bills — `clientRef` makes
 *  POST /bills idempotent (routes/bills.ts + services/billing.ts), so a flush that partially
 *  succeeds and gets interrupted is safe to retry from scratch. */
export async function flushBillQueue(token: string): Promise<{ synced: number; remaining: number }> {
  const bills = await getQueuedBills();
  let synced = 0;

  for (const bill of bills) {
    try {
      await api.createWalkInBill(token, {
        paymentType: bill.paymentType,
        customerCode: bill.customerCode,
        vehicleNo: bill.vehicleNo,
        orderNo: bill.orderNo,
        pumpCode: bill.pumpCode,
        clientRef: bill.clientRef,
        lines: bill.lines,
      });
      await removeQueuedBill(bill.clientRef);
      synced++;
    } catch (err) {
      if (err instanceof ApiError) {
        await removeQueuedBill(bill.clientRef);
      }
      // else: still unreachable — leave queued for the next flush attempt
    }
  }

  const remaining = (await getQueuedBills()).length;
  return { synced, remaining };
}
