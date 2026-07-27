import { db } from "../db/client.js";

export interface MileageLogEntry {
  id: number;
  bill_no: number;
  vehicle_no: string;
  item_code: string;
  odometer_prev: number | null;
  odometer_curr: number;
  qty: number;
  mileage: number | null;
  created_at: string;
}

export const mileageRepo = {
  listByVehicle(vehicleNo: string): MileageLogEntry[] {
    return db
      .prepare("SELECT * FROM mileage_log WHERE vehicle_no = ? ORDER BY created_at")
      .all(vehicleNo) as unknown as MileageLogEntry[];
  },

  lastForVehicle(vehicleNo: string): MileageLogEntry | undefined {
    return db
      .prepare("SELECT * FROM mileage_log WHERE vehicle_no = ? ORDER BY id DESC LIMIT 1")
      .get(vehicleNo) as MileageLogEntry | undefined;
  },

  /** Records an odometer reading against a bill; computes km-per-unit mileage against the
   *  vehicle's previous reading (legacy MAGE: OR/CR odometer pair -> MILEAGE). Callers that
   *  capture both readings in one go (a tank-fill entry in billing) pass `odometerOpening`
   *  explicitly; otherwise it falls back to the vehicle's last recorded closing reading. */
  record(input: {
    billNo: number;
    vehicleNo: string;
    itemCode: string;
    odometerOpening?: number;
    odometerCurr: number;
    qty: number;
  }): MileageLogEntry {
    const odometerPrev =
      input.odometerOpening ?? mileageRepo.lastForVehicle(input.vehicleNo)?.odometer_curr ?? null;
    const mileage =
      odometerPrev !== null && input.qty > 0 ? (input.odometerCurr - odometerPrev) / input.qty : null;

    const result = db
      .prepare(
        `INSERT INTO mileage_log (bill_no, vehicle_no, item_code, odometer_prev, odometer_curr, qty, mileage)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.billNo, input.vehicleNo, input.itemCode, odometerPrev, input.odometerCurr, input.qty, mileage);

    return db
      .prepare("SELECT * FROM mileage_log WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as unknown as MileageLogEntry;
  },
};
