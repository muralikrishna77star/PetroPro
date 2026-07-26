#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "../db/client.js";
import { groupsRepo } from "../repositories/groups.js";
import { itemsRepo } from "../repositories/items.js";
import { customersRepo } from "../repositories/customers.js";
import { usersRepo } from "../repositories/users.js";
import { tenantsRepo } from "../repositories/tenants.js";
import { hashPassword } from "../services/auth.js";
import { readDbfRows, type DbfRow } from "./reader.js";

const workareaDir = process.argv[2] ?? path.resolve(process.cwd(), "..", "..", "legacy", "Workarea");

interface ImportSummary {
  table: string;
  totalRows: number;
  imported: number;
  skippedExisting: number;
  skippedInvalid: number;
}

function str(row: DbfRow, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(row: DbfRow, key: string): number {
  const v = row[key];
  return typeof v === "number" ? v : 0;
}

function importGroups(): ImportSummary {
  const summary: ImportSummary = { table: "groups", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  for (const row of readDbfRows(path.join(workareaDir, "GROUP.DBF"))) {
    summary.totalRows++;
    const code = str(row, "GROUP_CODE");
    if (!code) {
      summary.skippedInvalid++;
      continue;
    }
    if (groupsRepo.get(code)) {
      summary.skippedExisting++;
      continue;
    }
    groupsRepo.create({ code, name: str(row, "DESC") || code });
    summary.imported++;
  }
  return summary;
}

function importItems(): ImportSummary {
  const summary: ImportSummary = { table: "items", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  for (const row of readDbfRows(path.join(workareaDir, "ITEM.DBF"))) {
    summary.totalRows++;
    const code = str(row, "ICODE");
    if (!code) {
      summary.skippedInvalid++;
      continue;
    }
    if (itemsRepo.get(code)) {
      summary.skippedExisting++;
      continue;
    }
    const groupCode = str(row, "GROUP_CODE") || null;
    itemsRepo.create({
      code,
      name: str(row, "IDESC") || code,
      group_code: groupCode && groupsRepo.get(groupCode) ? groupCode : null,
      price_wholesale: num(row, "IPRICEW"),
      price_retail: num(row, "IPRICER"),
      purchase_value: num(row, "PUR_VAL"),
      track_mileage: str(row, "MAGE").toUpperCase() === "Y",
      tax_percent: num(row, "TAX_PER"),
    });
    summary.imported++;
  }
  return summary;
}

function importCustomers(): ImportSummary {
  const summary: ImportSummary = { table: "customers", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  for (const row of readDbfRows(path.join(workareaDir, "CUSTOMER.DBF"))) {
    summary.totalRows++;
    const code = str(row, "CUST_CODE");
    if (!code) {
      summary.skippedInvalid++;
      continue;
    }
    if (customersRepo.get(code)) {
      summary.skippedExisting++;
      continue;
    }
    customersRepo.create({
      code,
      joined_on: (row.DOJ as string | null) ?? null,
      name: str(row, "NAME") || code,
      address: str(row, "ADDRESS") || null,
      print_name: str(row, "PRINT") || null,
      phone: row.PHONE ? String(row.PHONE) : null,
      due_amount: num(row, "DUE_AMT"),
      credit_limit: num(row, "CR_LMT"),
      service_charge: num(row, "SER_CHG"),
      tin_no: str(row, "TINNO") || null,
      gst_no: str(row, "GSTNO") || null,
    });
    summary.imported++;
  }
  return summary;
}

/**
 * Fleet cards + vehicles both come from VEH_DET.DBF. The legacy FLEETCARD.DBF table is *not*
 * imported separately: it only records (customer, vehicle) pairs with no card-number field of
 * its own, so it can't populate fleet_cards.card_no (our schema's PK) — it's a subset of the
 * same association VEH_DET.FLEETCARD already carries. If that assumption turns out wrong,
 * revisit — the original FoxPro business logic behind the two tables isn't fully documented in
 * docs/DATA_DICTIONARY.md.
 */
function importVehiclesAndFleetCards(): { vehicles: ImportSummary; fleetCards: ImportSummary } {
  const vehicles: ImportSummary = { table: "vehicles", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const fleetCards: ImportSummary = { table: "fleet_cards", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };

  const knownFleetCards = new Set<string>();
  const existingVehicle = db.prepare("SELECT 1 FROM vehicles WHERE vehicle_no = ?");
  const existingFleetCard = db.prepare("SELECT 1 FROM fleet_cards WHERE card_no = ?");
  const insertFleetCard = db.prepare("INSERT INTO fleet_cards (card_no, customer_code, vehicle_no) VALUES (?, ?, ?)");
  const insertVehicle = db.prepare("INSERT INTO vehicles (vehicle_no, customer_code, fleet_card) VALUES (?, ?, ?)");

  db.exec("BEGIN");
  try {
    for (const row of readDbfRows(path.join(workareaDir, "VEH_DET.DBF"))) {
      vehicles.totalRows++;
      const vehicleNo = str(row, "VEH_NO");
      if (!vehicleNo) {
        vehicles.skippedInvalid++;
        continue;
      }
      if (existingVehicle.get(vehicleNo)) {
        vehicles.skippedExisting++;
        continue;
      }

      const customerCode = str(row, "CUST_CODE") || null;
      const validCustomer = customerCode && customersRepo.get(customerCode) ? customerCode : null;
      const fleetCard = str(row, "FLEETCARD") || null;

      if (fleetCard && !knownFleetCards.has(fleetCard)) {
        fleetCards.totalRows++;
        if (existingFleetCard.get(fleetCard)) {
          fleetCards.skippedExisting++;
        } else {
          insertFleetCard.run(fleetCard, validCustomer, vehicleNo);
          fleetCards.imported++;
        }
        knownFleetCards.add(fleetCard);
      }

      insertVehicle.run(vehicleNo, validCustomer, fleetCard && knownFleetCards.has(fleetCard) ? fleetCard : null);
      vehicles.imported++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { vehicles, fleetCards };
}

/**
 * USERTAB.PWD is a legacy plaintext/obfuscated value, not a bcrypt hash — it is intentionally
 * NOT imported. Every migrated user gets the same temporary password and must be reset before
 * real use; this is a security decision, not an oversight.
 */
const TEMPORARY_PASSWORD = "changeme123";

function importUsers(): ImportSummary {
  const summary: ImportSummary = { table: "users", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };
  const tempHash = hashPassword(TEMPORARY_PASSWORD);
  for (const row of readDbfRows(path.join(workareaDir, "USERTAB.DBF"))) {
    summary.totalRows++;
    const userId = str(row, "USER_ID");
    if (!userId) {
      summary.skippedInvalid++;
      continue;
    }
    if (usersRepo.getById(userId)) {
      summary.skippedExisting++;
      continue;
    }
    // LEVEL=2 is the only value the legacy app treats specially ("skip for member=2" hides admin
    // menu bars — see CLAUDE.md); every other observed value (0 in this dataset, 1 per
    // docs/DATA_DICTIONARY.md) is admin-equivalent access.
    const role = num(row, "LEVEL") === 2 ? "operator" : "super_admin";
    usersRepo.create({ user_id: userId, name: str(row, "NAME") || userId, password_hash: tempHash, role });
    summary.imported++;
  }
  return summary;
}

/**
 * HEADINGS.DBF (single row: CNAME/ADDR1/ADDR2/ADDLINE) + SETTINGS.DBF's GSTNO key hold the
 * dealer's real identity — never previously imported. Unlike the other importers this always
 * overwrites: `tenants` is a singleton config record, not an append-only table, so the DBF is
 * the source of truth on every run rather than something to skip once present.
 */
function importTenant(): ImportSummary {
  const summary: ImportSummary = { table: "tenant", totalRows: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0 };

  let name = "";
  let addressLine1 = "";
  let addressLine2 = "";
  let tagline = "";
  for (const row of readDbfRows(path.join(workareaDir, "HEADINGS.DBF"))) {
    summary.totalRows++;
    name = str(row, "CNAME");
    addressLine1 = str(row, "ADDR1");
    addressLine2 = str(row, "ADDR2");
    tagline = str(row, "ADDLINE");
    break; // singleton table
  }

  if (!name) {
    summary.skippedInvalid++;
    return summary;
  }

  let gstNo = "";
  for (const row of readDbfRows(path.join(workareaDir, "SETTINGS.DBF"))) {
    if (str(row, "KEY") === "GSTNO") {
      gstNo = str(row, "VALUE");
      break;
    }
  }

  // payment_qr_code is admin-configured in Settings, not part of the legacy DBFs — preserve
  // whatever's already set rather than wiping it out on every re-import.
  tenantsRepo.update({
    name,
    address_line1: addressLine1 || null,
    address_line2: addressLine2 || null,
    tagline: tagline || null,
    gst_no: gstNo || null,
    payment_qr_code: tenantsRepo.get().payment_qr_code,
  });
  summary.imported++;
  return summary;
}

export function runImport(): ImportSummary[] {
  const results = [importGroups(), importItems(), importCustomers()];
  const { vehicles, fleetCards } = importVehiclesAndFleetCards();
  results.push(fleetCards, vehicles, importUsers(), importTenant());
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Importing legacy data from ${workareaDir}\n`);
  const results = runImport();
  for (const r of results) {
    console.log(
      `${r.table}: ${r.imported} imported, ${r.skippedExisting} already present, ${r.skippedInvalid} invalid (of ${r.totalRows} DBF rows)`,
    );
  }
  console.log(
    `\nImported users have a temporary password ("${TEMPORARY_PASSWORD}") — reset before real use.`,
  );
}
