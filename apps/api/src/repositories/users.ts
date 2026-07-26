import { db } from "../db/client.js";
import type { Role } from "@petropro/shared-types";

export type { Role };

export interface User {
  user_id: string;
  name: string;
  password_hash: string;
  role: Role;
  active: number;
  created_at: string;
}

export type PublicUser = Omit<User, "password_hash">;

export const usersRepo = {
  list(): PublicUser[] {
    return db
      .prepare("SELECT user_id, name, role, active, created_at FROM users ORDER BY user_id")
      .all() as unknown as PublicUser[];
  },

  getById(userId: string): User | undefined {
    return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as User | undefined;
  },

  create(input: { user_id: string; name: string; password_hash: string; role: Role }): PublicUser {
    db.prepare(
      "INSERT INTO users (user_id, name, password_hash, role) VALUES (?, ?, ?, ?)",
    ).run(input.user_id, input.name, input.password_hash, input.role);
    return { user_id: input.user_id, name: input.name, role: input.role, active: 1, created_at: new Date().toISOString() };
  },

  update(userId: string, input: { name: string; role: Role }): PublicUser | undefined {
    db.prepare("UPDATE users SET name = ?, role = ? WHERE user_id = ?").run(input.name, input.role, userId);
    const updated = usersRepo.getById(userId);
    if (!updated) return undefined;
    const { password_hash: _unused, ...rest } = updated;
    return rest;
  },

  setActive(userId: string, active: boolean): PublicUser | undefined {
    db.prepare("UPDATE users SET active = ? WHERE user_id = ?").run(active ? 1 : 0, userId);
    const updated = usersRepo.getById(userId);
    if (!updated) return undefined;
    const { password_hash: _unused, ...rest } = updated;
    return rest;
  },

  setPasswordHash(userId: string, passwordHash: string): void {
    db.prepare("UPDATE users SET password_hash = ? WHERE user_id = ?").run(passwordHash, userId);
  },
};
