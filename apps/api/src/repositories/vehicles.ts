import { db } from "../db/client.js";

export interface Vehicle {
  vehicle_no: string;
  customer_code: string | null;
  fleet_card: string | null;
}

export const vehiclesRepo = {
  list(): Vehicle[] {
    return db.prepare("SELECT * FROM vehicles ORDER BY vehicle_no").all() as unknown as Vehicle[];
  },

  get(vehicleNo: string): Vehicle | undefined {
    return db.prepare("SELECT * FROM vehicles WHERE vehicle_no = ?").get(vehicleNo) as
      | Vehicle
      | undefined;
  },

  create(input: Vehicle): Vehicle {
    db.prepare(
      "INSERT INTO vehicles (vehicle_no, customer_code, fleet_card) VALUES (?, ?, ?)",
    ).run(input.vehicle_no, input.customer_code ?? null, input.fleet_card ?? null);
    return input;
  },

  findOrCreate(vehicleNo: string): Vehicle {
    const existing = vehiclesRepo.get(vehicleNo);
    if (existing) return existing;
    return vehiclesRepo.create({ vehicle_no: vehicleNo, customer_code: null, fleet_card: null });
  },
};
