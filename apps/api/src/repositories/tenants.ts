import { db } from "../db/client.js";

export interface Tenant {
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  tagline: string | null;
  gst_no: string | null;
  /** Data URL (image/png;base64,...) of the outlet's existing UPI/payment QR code — shown as-is
   *  on the attendant/billing/cashier screens for "upi" payments; no gateway integration, the
   *  attendant/cashier confirm receipt manually. Configured once in Settings. */
  payment_qr_code: string | null;
}

export const tenantsRepo = {
  get(): Tenant {
    return db
      .prepare("SELECT name, address_line1, address_line2, tagline, gst_no, payment_qr_code FROM tenants WHERE id = 1")
      .get() as unknown as Tenant;
  },

  update(input: Tenant): Tenant {
    db.prepare(
      "UPDATE tenants SET name = ?, address_line1 = ?, address_line2 = ?, tagline = ?, gst_no = ?, payment_qr_code = ? WHERE id = 1",
    ).run(
      input.name,
      input.address_line1 ?? null,
      input.address_line2 ?? null,
      input.tagline ?? null,
      input.gst_no ?? null,
      input.payment_qr_code ?? null,
    );
    return tenantsRepo.get();
  },
};
