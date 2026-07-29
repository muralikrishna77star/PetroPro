import type { DatabaseSync } from "node:sqlite";

interface ColumnInfo {
  name: string;
}

/** SQLite has no `ADD COLUMN IF NOT EXISTS`; used to evolve tables created by earlier phases. */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * See docs/DATA_DICTIONARY.md for full legacy field mapping. Customer ledger is computed on
 * the fly from opening_balances + bills + receipts (services/ledger.ts) rather than stored as
 * its own table, to avoid keeping a second copy of the same facts in sync.
 */
export function applySchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS groups (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    -- Pump count/naming is configured by admin/owner (Settings) — no legacy analog, this is a
    -- PWA-only addition. Optional on both pending_transactions and bills (see ensureColumn below).
    CREATE TABLE IF NOT EXISTS pumps (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_code TEXT REFERENCES groups(code),
      price_wholesale REAL NOT NULL DEFAULT 0,
      price_retail REAL NOT NULL DEFAULT 0,
      purchase_value REAL NOT NULL DEFAULT 0,
      track_mileage INTEGER NOT NULL DEFAULT 0,
      tax_percent REAL NOT NULL DEFAULT 0,
      price_wholesale_pretax REAL NOT NULL DEFAULT 0,
      price_wholesale_tax REAL NOT NULL DEFAULT 0,
      price_retail_pretax REAL NOT NULL DEFAULT 0,
      price_retail_tax REAL NOT NULL DEFAULT 0,
      purchase_value_pretax REAL NOT NULL DEFAULT 0,
      purchase_value_tax REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS customers (
      code TEXT PRIMARY KEY,
      joined_on TEXT,
      name TEXT NOT NULL,
      address TEXT,
      print_name TEXT,
      phone TEXT,
      due_amount REAL NOT NULL DEFAULT 0,
      credit_limit REAL NOT NULL DEFAULT 0,
      service_charge REAL NOT NULL DEFAULT 0,
      tin_no TEXT,
      gst_no TEXT
    );

    CREATE TABLE IF NOT EXISTS fleet_cards (
      card_no TEXT PRIMARY KEY,
      customer_code TEXT REFERENCES customers(code),
      vehicle_no TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      vehicle_no TEXT PRIMARY KEY,
      customer_code TEXT REFERENCES customers(code),
      fleet_card TEXT REFERENCES fleet_cards(card_no)
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'owner', 'operator', 'field_operator')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bills (
      bill_no INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_date TEXT NOT NULL DEFAULT (datetime('now')),
      vehicle_no TEXT REFERENCES vehicles(vehicle_no),
      customer_code TEXT REFERENCES customers(code),
      user_id TEXT REFERENCES users(user_id),
      sub_total REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0,
      payment_type TEXT NOT NULL DEFAULT 'cash',
      status TEXT NOT NULL DEFAULT 'active',
      order_no TEXT
    );

    CREATE TABLE IF NOT EXISTS bill_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no INTEGER NOT NULL REFERENCES bills(bill_no),
      item_code TEXT NOT NULL REFERENCES items(code),
      qty REAL NOT NULL,
      rate REAL NOT NULL,
      rate_pretax REAL NOT NULL,
      amount REAL NOT NULL,
      tax_percent REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      is_retail INTEGER NOT NULL DEFAULT 1,
      service_charge REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pending_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_no TEXT NOT NULL,
      item_code TEXT NOT NULL REFERENCES items(code),
      qty REAL,
      amount REAL,
      odometer REAL,
      attendant_id TEXT NOT NULL REFERENCES users(user_id),
      status TEXT NOT NULL DEFAULT 'pending',
      bill_no INTEGER REFERENCES bills(bill_no),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Phase 2: stock day-book, purchases, scheduled rate changes, customer receipts/opening balances.

    CREATE TABLE IF NOT EXISTS stock_daybook (
      item_code TEXT NOT NULL REFERENCES items(code),
      sdate TEXT NOT NULL,
      opening REAL NOT NULL DEFAULT 0,
      receipts REAL NOT NULL DEFAULT 0,
      damaged REAL NOT NULL DEFAULT 0,
      sales REAL NOT NULL DEFAULT 0,
      closing REAL NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 0,
      closed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (item_code, sdate)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL REFERENCES items(code),
      qty REAL NOT NULL,
      value REAL NOT NULL,
      pur_date TEXT NOT NULL DEFAULT (datetime('now')),
      invoice_no TEXT,
      vat_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rate_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL REFERENCES items(code),
      rate REAL NOT NULL,
      scheduled_on TEXT NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_at TEXT
    );

    CREATE TABLE IF NOT EXISTS opening_balances (
      customer_code TEXT NOT NULL REFERENCES customers(code),
      op_date TEXT NOT NULL,
      op_balance REAL NOT NULL,
      PRIMARY KEY (customer_code, op_date)
    );

    CREATE TABLE IF NOT EXISTS receipts (
      rec_no INTEGER PRIMARY KEY AUTOINCREMENT,
      rec_date TEXT NOT NULL DEFAULT (datetime('now')),
      customer_code TEXT NOT NULL REFERENCES customers(code),
      amount REAL NOT NULL,
      mode TEXT NOT NULL DEFAULT 'cash',
      cheque_no TEXT,
      bank_name TEXT,
      service_charge REAL NOT NULL DEFAULT 0,
      cashier_id TEXT REFERENCES users(user_id)
    );

    -- Phase 3: mileage tracking + printed-invoice letterhead.

    CREATE TABLE IF NOT EXISTS mileage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no INTEGER NOT NULL REFERENCES bills(bill_no),
      vehicle_no TEXT NOT NULL,
      item_code TEXT NOT NULL REFERENCES items(code),
      odometer_prev REAL,
      odometer_curr REAL NOT NULL,
      qty REAL NOT NULL,
      mileage REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per deployment (each customer gets their own database/instance, not a shared
    -- multi-tenant schema) — see Project_Status.md for why. Seeded generically here; real
    -- per-customer identity comes from dbf/import.ts's importTenant() or the Settings screen.
    DROP TABLE IF EXISTS company_profile;
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'PetroPro',
      address_line1 TEXT,
      address_line2 TEXT,
      tagline TEXT,
      gst_no TEXT,
      payment_qr_code TEXT
    );
    INSERT OR IGNORE INTO tenants (id, name) VALUES (1, 'PetroPro');

    -- Legacy SETTINGS.DBF-style operational flags (key/value, same shape as the original).
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('KEROSENE', 'NO'),
      ('FLEETCARDENTRY', 'NO'),
      ('PRINTTESTMODE', 'YES'),
      ('PRINTSPECIALCHARACTERS', 'NO'),
      ('BILLENTRY', 'NO'),
      ('GSTNAMEADD', 'NO'),
      ('AUTOBACKUP', 'YES'),
      ('OFFLINEMODE', 'NO');

    -- Phase 4: shifts, audit trail, financial year, offline-entry dedup.

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      expected_cash REAL,
      variance REAL,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(user_id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fin_years (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fin_year_start TEXT NOT NULL
    );
    INSERT OR IGNORE INTO fin_years (id, fin_year_start) VALUES (1, date('now', 'start of year'));

    -- The "running" business date bills/stock postings use, distinct from the wall-clock date:
    -- it only moves forward when a cashier closes the day (repositories/businessDate.ts), so it
    -- can lag behind the real calendar date but never run ahead of it.
    -- Column deliberately NOT named current_date/current_time/current_timestamp — those are
    -- SQLite pseudo-column keywords, and a bare (unqualified/unquoted) SELECT of a column with
    -- one of those names silently returns the built-in value instead of what's actually stored.
    CREATE TABLE IF NOT EXISTS business_date (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      running_date TEXT NOT NULL
    );
    INSERT OR IGNORE INTO business_date (id, running_date) VALUES (1, date('now'));

    -- Phase 6: customer-placed orders, served incrementally across one or more bills until
    -- every line's qty_served reaches qty_ordered (see services/orderFulfillment hookup in
    -- services/billing.ts). No legacy analog — the FoxPro system's "order_no" (see bills.order_no
    -- above) was always just a free-text credit-sale reference, never a real order entity.
    CREATE TABLE IF NOT EXISTS orders (
      order_no INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT NOT NULL REFERENCES customers(code),
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT,
      cancelled_by TEXT
    );

    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no INTEGER NOT NULL REFERENCES orders(order_no),
      item_code TEXT NOT NULL REFERENCES items(code),
      qty_ordered REAL NOT NULL,
      qty_served REAL NOT NULL DEFAULT 0,
      rate_at_order REAL NOT NULL
    );

    -- WhatsApp Invoice Module (Community edition) — see
    -- PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf. One row per deployment, same
    -- singleton pattern as tenants/fin_years. business_api_enabled is stored for forward
    -- compatibility with the Professional-edition architecture the brief asks for, but nothing
    -- reads it yet — WhatsAppBusinessProvider on the frontend is a "coming soon" stub regardless.
    CREATE TABLE IF NOT EXISTS communication_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      whatsapp_enabled INTEGER NOT NULL DEFAULT 1,
      default_country_code TEXT NOT NULL DEFAULT '91',
      message_template TEXT NOT NULL DEFAULT 'Hello {customerName}, thank you for your purchase at {tenantName}. Your invoice #{billNo} for Rs.{amount} is ready. We will share the PDF separately.',
      auto_open_whatsapp INTEGER NOT NULL DEFAULT 1,
      business_api_enabled INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO communication_settings (id) VALUES (1);

    -- One row per send attempt, any channel. Community edition only ever writes 'whatsapp' and
    -- 'share_pdf' rows — sending happens client-side (wa.me / Web Share API), so status reflects
    -- what the browser could observe (opened/shared/failed), not a WhatsApp delivery receipt.
    CREATE TABLE IF NOT EXISTS communication_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_no INTEGER NOT NULL REFERENCES bills(bill_no),
      customer_code TEXT REFERENCES customers(code),
      mobile_number TEXT,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      remarks TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(db, "bills", "cancelled_by", "TEXT REFERENCES users(user_id)");
  ensureColumn(db, "bills", "cancelled_at", "TEXT");
  ensureColumn(db, "bills", "order_no", "TEXT");
  ensureColumn(db, "bills", "pump_code", "TEXT REFERENCES pumps(code)");
  ensureColumn(db, "pending_transactions", "client_ref", "TEXT");
  ensureColumn(db, "pending_transactions", "pump_code", "TEXT REFERENCES pumps(code)");
  ensureColumn(db, "tenants", "payment_qr_code", "TEXT");
  ensureColumn(db, "users", "active", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "customers", "email", "TEXT");
  ensureColumn(db, "customers", "password_hash", "TEXT");
  ensureColumn(db, "bill_lines", "order_line_id", "INTEGER REFERENCES order_lines(id)");
  ensureColumn(db, "items", "hsn_code", "TEXT");
  // Optional Google SSO identity for a staff user — see routes/googleAuth.ts. Nullable so
  // user-id/password login keeps working for anyone with no email on file.
  ensureColumn(db, "users", "email", "TEXT");
  // Idempotency key for offline-queued bill submissions (see lib/offlineQueue.ts on the web
  // side) — the same "retry-safe because the client_ref already exists" pattern
  // pending_transactions.client_ref already uses.
  ensureColumn(db, "bills", "client_ref", "TEXT");

  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_transactions_client_ref ON pending_transactions(client_ref) WHERE client_ref IS NOT NULL",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_client_ref ON bills(client_ref) WHERE client_ref IS NOT NULL",
  );
}
