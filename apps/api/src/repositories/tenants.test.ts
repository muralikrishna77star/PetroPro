import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { tenantsRepo } = await import("./tenants.js");

test("get() returns the generic bootstrap default before any update", () => {
  const tenant = tenantsRepo.get();
  assert.equal(tenant.name, "PetroPro");
  assert.equal(tenant.address_line1, null);
  assert.equal(tenant.gst_no, null);
});

test("update() round-trips every field and persists across calls", () => {
  const updated = tenantsRepo.update({
    name: "Srinivasa Agencies",
    address_line1: "Dealers of IOCL",
    address_line2: "#490, G.N.T Road, Thandalkalani, CH-66",
    tagline: "Use Always Servo Lubricants",
    gst_no: "33AABFS4726N1Z0",
    payment_qr_code: "data:image/png;base64,abc123",
  });
  assert.equal(updated.name, "Srinivasa Agencies");
  assert.equal(updated.tagline, "Use Always Servo Lubricants");
  assert.equal(updated.gst_no, "33AABFS4726N1Z0");
  assert.equal(updated.payment_qr_code, "data:image/png;base64,abc123");

  const reread = tenantsRepo.get();
  assert.equal(reread.name, "Srinivasa Agencies");
  assert.equal(reread.address_line2, "#490, G.N.T Road, Thandalkalani, CH-66");
  assert.equal(reread.payment_qr_code, "data:image/png;base64,abc123");
});
