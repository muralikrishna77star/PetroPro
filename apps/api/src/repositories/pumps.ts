import { db } from "../db/client.js";

export interface Pump {
  code: string;
  name: string;
}

export const pumpsRepo = {
  list(): Pump[] {
    return db.prepare("SELECT code, name FROM pumps ORDER BY code").all() as unknown as Pump[];
  },

  get(code: string): Pump | undefined {
    return db.prepare("SELECT code, name FROM pumps WHERE code = ?").get(code) as Pump | undefined;
  },

  create(pump: Pump): Pump {
    db.prepare("INSERT INTO pumps (code, name) VALUES (?, ?)").run(pump.code, pump.name);
    return pump;
  },

  update(code: string, name: string): Pump | undefined {
    db.prepare("UPDATE pumps SET name = ? WHERE code = ?").run(name, code);
    return pumpsRepo.get(code);
  },
};
