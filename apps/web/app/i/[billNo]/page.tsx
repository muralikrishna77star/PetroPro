"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Fuel } from "lucide-react";
import { publicApi, ApiError, type PublicInvoice } from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/ui/Button";

/** The QR-code invoice flow's landing page (Community edition — see
 *  PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf). No login of any kind — a customer's own
 *  phone camera opens this straight from a QR code shown at the counter (SendInvoiceButton's
 *  "Customer scans QR"). Access is entirely the `t` token in the URL, verified server-side against
 *  the one bill it was minted for (routes/publicInvoice.ts); there is nothing here a staff or
 *  customer-portal session could add, so this page never touches lib/auth.ts or
 *  lib/customerAuth.ts. */
export default function PublicInvoicePage() {
  const params = useParams<{ billNo: string }>();
  const billNo = Number(params.billNo);
  const [token, setToken] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  useEffect(() => {
    // window.location.search, not useSearchParams() — matches app/login/page.tsx's reasoning:
    // this page has no other reason to be Suspense-gated.
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t || !billNo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bridging from the URL, an external system
      setError("This invoice link is incomplete. Ask the counter to share it again.");
      setLoading(false);
      return;
    }
    setToken(t);
    publicApi
      .getInvoice(billNo, t)
      .then(setInvoice)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load this invoice — check your connection"),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleShare() {
    if (!token) return;
    setSharing(true);
    setShareNotice(null);
    const pdfUrl = publicApi.invoicePdfUrl(billNo, token);
    const filename = `invoice-${billNo}.pdf`;
    try {
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error("PDF fetch failed");
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "application/pdf" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setShareNotice("Downloaded — share it from your Downloads/Files app.");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setShareNotice("Couldn't share the PDF — try Download instead.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-1 items-start justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-fg-muted">
          <Fuel size={18} />
          <span className="text-sm font-medium">PetroPro</span>
        </div>

        {loading && <p className="text-center text-sm text-fg-muted">Loading your invoice...</p>}
        {error && !loading && (
          <Card color="error" className="text-center text-sm text-error">
            {error}
          </Card>
        )}

        {invoice && (
          <Card color="orange" className="flex flex-col gap-4">
            <div className="text-center">
              <h1 className="text-lg font-semibold text-fg">{invoice.tenant.name}</h1>
              {invoice.tenant.address_line1 && (
                <p className="text-xs text-fg-muted">{invoice.tenant.address_line1}</p>
              )}
              {invoice.tenant.address_line2 && (
                <p className="text-xs text-fg-muted">{invoice.tenant.address_line2}</p>
              )}
              {invoice.tenant.gst_no && <p className="text-xs text-fg-muted">GSTIN: {invoice.tenant.gst_no}</p>}
              {invoice.tenant.tagline && <p className="text-xs italic text-fg-muted">{invoice.tenant.tagline}</p>}
            </div>

            {invoice.bill.status === "cancelled" && (
              <p className="rounded-lg bg-error/10 py-1.5 text-center text-sm font-semibold text-error">
                ** CANCELLED **
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
              <span>
                Invoice <span className="font-mono font-medium">#{invoice.bill.bill_no}</span>
              </span>
              <span className="text-fg-muted">{invoice.bill.bill_date}</span>
            </div>
            <div className="text-sm text-fg-muted">
              {invoice.bill.vehicle_no && <p>Vehicle: {invoice.bill.vehicle_no}</p>}
              {invoice.bill.customer_code && <p>Customer: {invoice.bill.customer_code}</p>}
              <p className="capitalize">Payment: {invoice.bill.payment_type}</p>
            </div>

            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-fg-muted">
                  <th className="py-1 pr-2 font-normal">Item</th>
                  <th className="py-1 pr-2 font-normal">Qty</th>
                  <th className="py-1 font-normal text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.id} className="border-b border-border">
                    <td className="py-1 pr-2">{line.item_code}</td>
                    <td className="py-1 pr-2">{line.qty}</td>
                    <td className="py-1 text-right">₹{line.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-sm">
              <div className="flex justify-between">
                <span className="text-fg-muted">Sub total</span>
                <span>₹{invoice.bill.sub_total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">Tax</span>
                <span>₹{invoice.bill.tax_total.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex justify-between text-base font-semibold">
                <span>Grand total</span>
                <span>₹{invoice.bill.grand_total.toFixed(2)}</span>
              </div>
              <p className="mt-2 text-xs italic text-fg-muted">{invoice.amountInWords}</p>
            </div>

            <div className="flex gap-2">
              <a
                href={publicApi.invoicePdfUrl(billNo, token ?? "")}
                target="_blank"
                rel="noreferrer"
                className="flex-1"
              >
                <Button variant="outline" className="w-full">
                  Download PDF
                </Button>
              </a>
              <Button className="flex-1" onClick={handleShare} disabled={sharing}>
                {sharing ? "Sharing..." : "Share"}
              </Button>
            </div>
            {shareNotice && <p className="text-center text-xs text-fg-muted">{shareNotice}</p>}
          </Card>
        )}
      </div>
    </div>
  );
}
