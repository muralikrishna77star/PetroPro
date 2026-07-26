"use client";

/** Shown wherever a cashier/attendant screen offers "UPI" as a payment type — displays the
 *  outlet's own QR code (configured once in Settings, see components/ui form there) so the
 *  customer can scan and pay. There's no payment-gateway integration behind this: the
 *  attendant/cashier has to look at their own phone/bank app and manually tick the confirmation
 *  before the bill can be finalized. */
export function PaymentQrPanel({
  qrCode,
  confirmed,
  onConfirmChange,
}: {
  qrCode: string | null;
  confirmed: boolean;
  onConfirmChange: (confirmed: boolean) => void;
}) {
  return (
    <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-4">
      {qrCode ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL, not an optimizable remote image
        <img src={qrCode} alt="Payment QR code" className="mx-auto h-48 w-48 rounded-lg object-contain" />
      ) : (
        <p className="text-center text-sm text-fg-muted">
          No QR code configured yet — add one in Settings → Payment QR Code.
        </p>
      )}
      <label className="mt-3 flex items-center justify-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmChange(e.target.checked)} />
        Customer has paid — confirmed
      </label>
    </div>
  );
}
