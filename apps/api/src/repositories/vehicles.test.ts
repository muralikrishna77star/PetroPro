import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { customersRepo } = await import("./customers.js");
const { itemsRepo } = await import("./items.js");
const { usersRepo } = await import("./users.js");
const { vehiclesRepo, vehicleKey } = await import("./vehicles.js");
const { createWalkInBill } = await import("../services/billing.js");

usersRepo.create({ user_id: "desk", name: "Desk", password_hash: "x", role: "operator" });
customersRepo.create({ code: "FLEET", name: "Fleet Co" } as never);
customersRepo.create({ code: "OTHER", name: "Other Co" } as never);
itemsRepo.create({ code: "DSL", name: "DIESEL", price_wholesale: 90, price_retail: 90, purchase_value: 85, tax_percent: 0 });

const bill = (vehicleNo: string, customerCode?: string) =>
  createWalkInBill({
    cashierId: "desk",
    paymentType: customerCode ? "credit" : "cash",
    customerCode,
    vehicleNo,
    lines: [{ item_code: "DSL", qty: 1 }],
  });

test("vehicleKey ignores spaces, hyphens and case", () => {
  assert.equal(vehicleKey(" tn 01-ab 1234 "), "TN01AB1234");
});

test("a new vehicle on a credit bill joins the master under that customer, and is found again however it's typed", () => {
  const first = bill("tn 09 cd 5678", "FLEET");
  assert.equal(first.bill.vehicle_no, "TN09CD5678");
  assert.equal(vehiclesRepo.get("TN09CD5678")?.customer_code, "FLEET");

  const again = bill("TN-09-CD-5678");
  assert.equal(again.bill.vehicle_no, "TN09CD5678");
  assert.equal(again.bill.customer_code, "FLEET", "a cash bill still picks up the vehicle's owner");
  assert.equal(vehiclesRepo.list().filter((v) => v.vehicle_no.includes("5678")).length, 1);
});

test("a vehicle already owned by one customer keeps its owner", () => {
  bill("KA01XY0001", "FLEET");
  bill("KA01XY0001", "OTHER");
  assert.equal(vehiclesRepo.get("KA01XY0001")?.customer_code, "FLEET");
});

test("legacy rows inserted without a key are still found by their cleaned-up number", () => {
  db.prepare("INSERT INTO vehicles (vehicle_no, customer_code) VALUES ('AP 16 BB 4321', 'OTHER')").run();
  assert.equal(vehiclesRepo.resolve("ap16bb4321")?.vehicle_no, "AP 16 BB 4321");
});

test("near matches find the same plate keyed differently and one-character typos, and merge moves the bills", () => {
  db.prepare("INSERT INTO vehicles (vehicle_no, customer_code) VALUES ('MH12 QQ 7777', NULL)").run();
  vehiclesRepo.create({ vehicle_no: "MH12QQ7777", customer_code: "FLEET", fleet_card: null });
  vehiclesRepo.create({ vehicle_no: "MH12QQ7771", customer_code: null, fleet_card: null });
  vehiclesRepo.create({ vehicle_no: "MH12QQ7O77", customer_code: null, fleet_card: null }); // letter O
  const typo = bill("MH12QQ7771");
  const spaced = bill("MH12 QQ 7777");
  assert.equal(spaced.bill.vehicle_no, "MH12 QQ 7777", "an exact match wins over the cleaned-up one");

  const group = vehiclesRepo.nearMatches().find((g) => g.vehicles.some((v) => v.vehicle_no === "MH12QQ7777"));
  assert.ok(group);
  assert.equal(group.kind, "similar");
  assert.deepEqual(group.vehicles.map((v) => v.vehicle_no).sort(), ["MH12 QQ 7777", "MH12QQ7777", "MH12QQ7771", "MH12QQ7O77"].sort());

  const result = vehiclesRepo.merge("MH12QQ7777", ["MH12 QQ 7777", "MH12QQ7771", "MH12QQ7O77"]);
  assert.equal(result.bills, 2);
  for (const billNo of [typo.bill.bill_no, spaced.bill.bill_no]) {
    assert.equal((db.prepare("SELECT vehicle_no FROM bills WHERE bill_no = ?").get(billNo) as { vehicle_no: string }).vehicle_no, "MH12QQ7777");
  }
  assert.equal(vehiclesRepo.get("MH12QQ7771"), undefined);
  assert.ok(!vehiclesRepo.nearMatches().some((g) => g.vehicles.some((v) => v.vehicle_no === "MH12QQ7777")));
});

test("numbers marked as different vehicles stop being suggested", () => {
  vehiclesRepo.create({ vehicle_no: "DL01AA1001", customer_code: "FLEET", fleet_card: null });
  vehiclesRepo.create({ vehicle_no: "DL01AA1002", customer_code: "FLEET", fleet_card: null });
  const has = () => vehiclesRepo.nearMatches().some((g) => g.vehicles.some((v) => v.vehicle_no === "DL01AA1001"));
  assert.equal(has(), true);
  vehiclesRepo.markDistinct(["DL01AA1001", "DL01AA1002"]);
  assert.equal(has(), false);
});

test("merge refuses unknown numbers and changes nothing", () => {
  assert.throws(() => vehiclesRepo.merge("DL01AA1001", ["NOPE123"]), /not found/);
  assert.throws(() => vehiclesRepo.merge("DL01AA1001", ["DL01AA1001"]), /at least one/);
  assert.ok(vehiclesRepo.get("DL01AA1001"));
});
