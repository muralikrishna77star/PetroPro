import { db } from "./client.js";
import { groupsRepo } from "../repositories/groups.js";
import { itemsRepo } from "../repositories/items.js";
import { usersRepo, type Role } from "../repositories/users.js";
import { hashPassword } from "../services/auth.js";

function seedUser(userId: string, name: string, password: string, role: Role) {
  if (usersRepo.getById(userId)) return;
  usersRepo.create({ user_id: userId, name, password_hash: hashPassword(password), role });
}

function seedGroup(code: string, name: string) {
  if (!groupsRepo.get(code)) groupsRepo.create({ code, name });
}

function seedItem(input: Parameters<typeof itemsRepo.create>[0]) {
  if (!itemsRepo.get(input.code)) itemsRepo.create(input);
}

seedUser("admin", "Administrator", "admin123", "super_admin");
seedUser("cashier1", "Cashier One", "cashier123", "operator");
seedUser("attendant1", "Attendant One", "attendant123", "field_operator");

seedGroup("F", "Fuel");
seedGroup("L", "Lubricant");

seedItem({
  code: "PET",
  name: "Petrol",
  group_code: "F",
  price_wholesale: 96.72,
  price_retail: 96.72,
  purchase_value: 92.0,
  track_mileage: true,
  tax_percent: 18,
});
seedItem({
  code: "DSL",
  name: "Diesel",
  group_code: "F",
  price_wholesale: 89.62,
  price_retail: 89.62,
  purchase_value: 85.0,
  track_mileage: true,
  tax_percent: 18,
});
seedItem({
  code: "OIL",
  name: "Engine Oil (1L)",
  group_code: "L",
  price_wholesale: 350,
  price_retail: 399,
  purchase_value: 280,
  track_mileage: false,
  tax_percent: 18,
});

console.log(`Seed complete: ${db.location() ?? "in-memory"}`);
