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
  email: string | null;
  google_sub: string | null;
}

/** Never carries the password hash or the Google id itself, only whether one is linked. */
export type PublicUser = Omit<User, "password_hash" | "google_sub"> & { google_linked: number };

function toPublic(user: User): PublicUser {
  const { password_hash: _hash, google_sub: googleSub, ...rest } = user;
  return { ...rest, google_linked: googleSub ? 1 : 0 };
}

export const usersRepo = {
  list(): PublicUser[] {
    return db
      .prepare(
        "SELECT user_id, name, role, active, created_at, email, (google_sub IS NOT NULL) AS google_linked FROM users ORDER BY user_id",
      )
      .all() as unknown as PublicUser[];
  },

  getById(userId: string): User | undefined {
    return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as User | undefined;
  },

  /** Used by Google SSO login (services/googleOAuth.ts) to find who a first sign-in links to. */
  getByEmail(email: string): User | undefined {
    return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
  },

  getByGoogleSub(googleSub: string): User | undefined {
    return db.prepare("SELECT * FROM users WHERE google_sub = ?").get(googleSub) as User | undefined;
  },

  /** Links a Google account to a user with none. Undefined if that couldn't happen, because the
   *  user was linked in the meantime or the Google account already belongs to someone. */
  linkGoogle(userId: string, googleSub: string): User | undefined {
    try {
      const { changes } = db
        .prepare("UPDATE users SET google_sub = ? WHERE user_id = ? AND google_sub IS NULL")
        .run(googleSub, userId);
      return changes === 1 ? usersRepo.getById(userId) : undefined;
    } catch {
      return undefined; // idx_users_google_sub: that Google account is on another user.
    }
  },

  /** True if there was a link to remove. */
  unlinkGoogle(userId: string): boolean {
    return db.prepare("UPDATE users SET google_sub = NULL WHERE user_id = ? AND google_sub IS NOT NULL").run(userId).changes === 1;
  },

  create(input: { user_id: string; name: string; password_hash: string; role: Role; email?: string | null }): PublicUser {
    db.prepare(
      "INSERT INTO users (user_id, name, password_hash, role, email) VALUES (?, ?, ?, ?, ?)",
    ).run(input.user_id, input.name, input.password_hash, input.role, input.email ?? null);
    return {
      user_id: input.user_id,
      name: input.name,
      role: input.role,
      active: 1,
      created_at: new Date().toISOString(),
      email: input.email ?? null,
      google_linked: 0,
    };
  },

  // `email` is omittable (vs. explicit null) so a caller that doesn't know about email at all
  // can't accidentally wipe out a previously-set one on every plain name/role update.
  // Changing the email drops any Google link: the link was granted for the old address, so
  // whoever now holds that Google account must not keep access.
  update(userId: string, input: { name: string; role: Role; email?: string | null }): PublicUser | undefined {
    if (input.email !== undefined) {
      db.prepare(
        "UPDATE users SET name = ?, role = ?, google_sub = CASE WHEN email IS ? THEN google_sub END, email = ? WHERE user_id = ?",
      ).run(input.name, input.role, input.email, input.email, userId);
    } else {
      db.prepare("UPDATE users SET name = ?, role = ? WHERE user_id = ?").run(input.name, input.role, userId);
    }
    const updated = usersRepo.getById(userId);
    return updated && toPublic(updated);
  },

  setActive(userId: string, active: boolean): PublicUser | undefined {
    db.prepare("UPDATE users SET active = ? WHERE user_id = ?").run(active ? 1 : 0, userId);
    const updated = usersRepo.getById(userId);
    return updated && toPublic(updated);
  },

  setPasswordHash(userId: string, passwordHash: string): void {
    db.prepare("UPDATE users SET password_hash = ? WHERE user_id = ?").run(passwordHash, userId);
  },
};
