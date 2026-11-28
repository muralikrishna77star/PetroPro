import { db } from "../db/client.js";

export interface Vehicle {
  vehicle_no: string;
  customer_code: string | null;
  fleet_card: string | null;
}

export interface VehicleWithUsage extends Vehicle {
  bill_count: number;
  last_bill_date: string | null;
}

export interface NearMatchGroup {
  /** "same": the numbers differ only in spaces, hyphens or case. "similar": one character apart
   *  (a typo, two characters swapped, or O/0 and I/1 mixed up) — possibly two real vehicles. */
  kind: "same" | "similar";
  vehicles: VehicleWithUsage[];
}

export interface MergeResult {
  kept: string;
  merged: string[];
  bills: number;
  pending_transactions: number;
  mileage_entries: number;
  orders: number;
}

/** A vehicle number reduced to what identifies the plate: capitals and digits only, so
 *  "tn 01-ab 1234" and "TN01AB1234" are the same vehicle. New vehicles are stored in this form. */
export function vehicleKey(vehicleNo: string): string {
  return vehicleNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Letters and digits that get keyed in for one another on number plates.
function confusableKey(key: string): string {
  return key.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Whether two keys are at most one edit apart: one character changed, added, dropped, or two
 *  neighbours swapped (optimal string alignment distance <= 1). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length && diffs.length <= 2; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i++;
  return shorter.slice(i) === longer.slice(i + 1);
}

/** Keys of vehicles that were looked at and confirmed to be different vehicles, so they stop
 *  showing up as near matches. Stored as an ordered pair. */
function distinctPairs(): Set<string> {
  const rows = db.prepare("SELECT key_a, key_b FROM vehicle_distinct_pairs").all() as { key_a: string; key_b: string }[];
  return new Set(rows.map((r) => `${r.key_a}|${r.key_b}`));
}

function pairId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Fills vehicle_key for rows written without it (legacy imports insert vehicles directly). */
function backfillKeys(): void {
  const rows = db.prepare("SELECT vehicle_no FROM vehicles WHERE vehicle_key IS NULL").all() as { vehicle_no: string }[];
  const update = db.prepare("UPDATE vehicles SET vehicle_key = ? WHERE vehicle_no = ?");
  for (const row of rows) update.run(vehicleKey(row.vehicle_no), row.vehicle_no);
}

export const vehiclesRepo = {
  list(): Vehicle[] {
    return db
      .prepare("SELECT vehicle_no, customer_code, fleet_card FROM vehicles ORDER BY vehicle_no")
      .all() as unknown as Vehicle[];
  },

  listByCustomer(customerCode: string): Vehicle[] {
    return db
      .prepare("SELECT vehicle_no, customer_code, fleet_card FROM vehicles WHERE customer_code = ? ORDER BY vehicle_no")
      .all(customerCode) as unknown as Vehicle[];
  },

  get(vehicleNo: string): Vehicle | undefined {
    return db
      .prepare("SELECT vehicle_no, customer_code, fleet_card FROM vehicles WHERE vehicle_no = ?")
      .get(vehicleNo) as Vehicle | undefined;
  },

  /** The vehicle on file for a number as typed: an exact match first, otherwise the one that
   *  differs only in spaces, hyphens or case. */
  resolve(vehicleNo: string): Vehicle | undefined {
    const typed = vehicleNo.trim();
    if (!typed) return undefined;
    const exact = vehiclesRepo.get(typed);
    if (exact) return exact;
    backfillKeys();
    return db
      .prepare(
        `SELECT vehicle_no, customer_code, fleet_card FROM vehicles WHERE vehicle_key = ?
          ORDER BY customer_code IS NULL, vehicle_no LIMIT 1`,
      )
      .get(vehicleKey(typed)) as Vehicle | undefined;
  },

  create(input: Vehicle): Vehicle {
    db.prepare("INSERT INTO vehicles (vehicle_no, customer_code, fleet_card, vehicle_key) VALUES (?, ?, ?, ?)").run(
      input.vehicle_no,
      input.customer_code ?? null,
      input.fleet_card ?? null,
      vehicleKey(input.vehicle_no),
    );
    return vehiclesRepo.get(input.vehicle_no) as Vehicle;
  },

  setOwner(vehicleNo: string, customerCode: string | null): Vehicle | undefined {
    db.prepare("UPDATE vehicles SET customer_code = ? WHERE vehicle_no = ?").run(customerCode, vehicleNo);
    return vehiclesRepo.get(vehicleNo);
  },

  /** The vehicle for a number as typed, adding it to the master when it's new. A new vehicle,
   *  or one on file with no owner yet, is put under `customerCode` when one is given; a vehicle
   *  already owned by a customer keeps its owner. */
  findOrCreate(vehicleNo: string, customerCode?: string | null): Vehicle {
    const existing = vehiclesRepo.resolve(vehicleNo);
    if (existing) {
      if (customerCode && !existing.customer_code) return vehiclesRepo.setOwner(existing.vehicle_no, customerCode) as Vehicle;
      return existing;
    }
    return vehiclesRepo.create({ vehicle_no: vehicleKey(vehicleNo), customer_code: customerCode ?? null, fleet_card: null });
  },

  /** Vehicle numbers that look like the same vehicle keyed in different ways, for the Vehicles
   *  screen's merge tool. Pairs confirmed as different vehicles (markDistinct) are left out. */
  nearMatches(): NearMatchGroup[] {
    const vehicles = db
      .prepare(
        `SELECT v.vehicle_no, v.customer_code, v.fleet_card,
                COUNT(b.bill_no) AS bill_count, MAX(b.bill_date) AS last_bill_date
           FROM vehicles v LEFT JOIN bills b ON b.vehicle_no = v.vehicle_no
          GROUP BY v.vehicle_no`,
      )
      .all() as unknown as VehicleWithUsage[];
    const keys = vehicles.map((v) => vehicleKey(v.vehicle_no));
    const loose = keys.map(confusableKey);
    const dismissed = distinctPairs();

    // Union-find over vehicles that match one another.
    const parent = vehicles.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const sameOnly = new Map<number, boolean>();
    const join = (i: number, j: number, same: boolean) => {
      const [ri, rj] = [find(i), find(j)];
      const groupSame = (sameOnly.get(ri) ?? true) && (sameOnly.get(rj) ?? true) && same;
      parent[ri] = rj;
      sameOnly.set(rj, groupSame);
    };

    // Compare only vehicles sharing the first four characters (state + district on Indian plates)
    // — keeps this quick on thousands of vehicles. Very short numbers are too ambiguous to compare.
    const buckets = new Map<string, number[]>();
    loose.forEach((key, i) => {
      if (key.length < 4) return;
      const bucket = buckets.get(key.slice(0, 4)) ?? [];
      bucket.push(i);
      buckets.set(key.slice(0, 4), bucket);
    });
    for (const members of buckets.values()) {
      for (let x = 0; x < members.length; x++) {
        for (let y = x + 1; y < members.length; y++) {
          const [i, j] = [members[x], members[y]];
          if (dismissed.has(pairId(keys[i], keys[j]))) continue;
          if (keys[i] === keys[j]) join(i, j, true);
          else if (loose[i].length >= 6 && oneEditApart(loose[i], loose[j])) join(i, j, false);
        }
      }
    }

    const groups = new Map<number, VehicleWithUsage[]>();
    vehicles.forEach((v, i) => {
      const root = find(i);
      groups.set(root, [...(groups.get(root) ?? []), v]);
    });
    return [...groups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([root, members]) => ({
        kind: (sameOnly.get(root) ?? true) ? ("same" as const) : ("similar" as const),
        vehicles: members.sort((a, b) => b.bill_count - a.bill_count),
      }))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "same" ? -1 : 1));
  },

  /** Records that these numbers are genuinely different vehicles, so the merge tool stops
   *  suggesting them. */
  markDistinct(vehicleNos: string[]): void {
    const keys = [...new Set(vehicleNos.map(vehicleKey))];
    const insert = db.prepare("INSERT OR IGNORE INTO vehicle_distinct_pairs (key_a, key_b) VALUES (?, ?)");
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const [a, b] = pairId(keys[i], keys[j]).split("|");
        insert.run(a, b);
      }
    }
  },

  /** Folds `merge` into `keep`: every bill, pending fuel entry, mileage entry, fleet card and
   *  order on a merged number moves to the kept one, then the merged numbers are removed from
   *  the master. The kept vehicle takes an owner/fleet card from a merged one only if it had none.
   *  One transaction — it all happens or none of it does. */
  merge(keep: string, merge: string[]): MergeResult {
    const kept = vehiclesRepo.get(keep);
    if (!kept) throw new Error(`Vehicle ${keep} not found`);
    const others = [...new Set(merge)].filter((no) => no !== keep);
    if (others.length === 0) throw new Error("Choose at least one other vehicle number to merge");
    const merged = others.map((no) => {
      const vehicle = vehiclesRepo.get(no);
      if (!vehicle) throw new Error(`Vehicle ${no} not found`);
      return vehicle;
    });

    const result: MergeResult = { kept: keep, merged: others, bills: 0, pending_transactions: 0, mileage_entries: 0, orders: 0 };
    db.exec("BEGIN");
    try {
      const owner = kept.customer_code ?? merged.find((v) => v.customer_code)?.customer_code ?? null;
      const card = kept.fleet_card ?? merged.find((v) => v.fleet_card)?.fleet_card ?? null;
      db.prepare("UPDATE vehicles SET customer_code = ?, fleet_card = ? WHERE vehicle_no = ?").run(owner, card, keep);
      for (const no of others) {
        result.bills += Number(db.prepare("UPDATE bills SET vehicle_no = ? WHERE vehicle_no = ?").run(keep, no).changes);
        result.pending_transactions += Number(
          db.prepare("UPDATE pending_transactions SET vehicle_no = ? WHERE vehicle_no = ?").run(keep, no).changes,
        );
        result.mileage_entries += Number(db.prepare("UPDATE mileage_log SET vehicle_no = ? WHERE vehicle_no = ?").run(keep, no).changes);
        result.orders += Number(db.prepare("UPDATE orders SET vehicle_no = ? WHERE vehicle_no = ?").run(keep, no).changes);
        db.prepare("UPDATE fleet_cards SET vehicle_no = ? WHERE vehicle_no = ?").run(keep, no);
        db.prepare("DELETE FROM vehicles WHERE vehicle_no = ?").run(no);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return result;
  },
};
