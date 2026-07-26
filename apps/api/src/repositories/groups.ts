import { db } from "../db/client.js";

export interface Group {
  code: string;
  name: string;
}

export const groupsRepo = {
  list(): Group[] {
    return db.prepare("SELECT code, name FROM groups ORDER BY code").all() as unknown as Group[];
  },

  get(code: string): Group | undefined {
    return db.prepare("SELECT code, name FROM groups WHERE code = ?").get(code) as Group | undefined;
  },

  create(group: Group): Group {
    db.prepare("INSERT INTO groups (code, name) VALUES (?, ?)").run(group.code, group.name);
    return group;
  },

  update(code: string, name: string): Group | undefined {
    db.prepare("UPDATE groups SET name = ? WHERE code = ?").run(name, code);
    return groupsRepo.get(code);
  },
};
