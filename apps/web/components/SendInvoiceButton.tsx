"use client";

import { useEffect, useRef, useState } from "react";
import { api, type CommunicationSettings } from "@/lib/api";
import { communicationService } from "@/lib/communication/CommunicationService";
import { isValidMobileNumber } from "@/lib/communication/mobileNumber";
import type { CommunicationChannel, CommunicationResult } from "@/lib/communication/types";

interface SendInvoiceButtonProps {
  token: string;
  billNo: number;
  amount: number;
  tenantName: string;
  customerCode?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  className?: string;
}

const COMING_SOON_CHANNELS: { channel: CommunicationChannel; label: string }[] = [
  { channel: "email", label: "Email" },
  { channel: "sms", label: "SMS" },
];

/** "Send Invoice" — Community-edition WhatsApp Invoice Module (see
 *  PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf). Shown after a bill is generated (or when
 *  looking one up again): WhatsApp and Share PDF are real; Email/SMS are visibly "coming soon"
 *  rather than hidden, so the eventual Professional-edition upgrade path is discoverable. */
export function SendInvoiceButton({
  token,
  billNo,
  amount,
  tenantName,
  customerCode,
  customerName,
  customerPhone,
  className,
}: SendInvoiceButtonProps) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CommunicationSettings | null>(null);
  // Initial value only — deliberately not kept in sync with the customerPhone prop via an
  // effect. Callers key this component by bill number (see billing/page.tsx), so a new bill or
  // lookup remounts it fresh rather than needing setState-on-prop-change.
  const [mobile, setMobile] = useState(customerPhone ?? "");
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState<CommunicationChannel | null>(null);
  const [result, setResult] = useState<CommunicationResult | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getCommunicationSettings(token).then(setSettings).catch(() => undefined);
  }, [token]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowConfirm(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const pdfUrl = api.invoicePdfUrl(billNo);
  const pdfFilename = `invoice-${billNo}.pdf`;
  const countryCode = settings?.default_country_code ?? "91";

  async function doSend(channel: CommunicationChannel) {
    if (!settings) return;
    setSending(channel);
    setResult(null);
    try {
      const res = await communicationService.send(
        channel,
        {
          billNo,
          customerCode: customerCode ?? null,
          customerName: customerName ?? null,
          mobileNumber: mobile || null,
          amount,
          pdfUrl,
          pdfFilename,
        },
        {
          token,
          tenantName,
          messageTemplate: settings.message_template,
          defaultCountryCode: countryCode,
        },
      );
      setResult(res);
      if (res.success) setShowConfirm(false);
    } finally {
      setSending(null);
    }
  }

  function handleWhatsAppClick() {
    setResult(null);
    const numberReady = isValidMobileNumber(mobile, countryCode);
    if (!numberReady || !settings?.auto_open_whatsapp) {
      setShowConfirm(true);
      return;
    }
    void doSend("whatsapp");
  }

  const whatsappEnabled = settings?.whatsapp_enabled ?? true;

  return (
    <div ref={containerRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-success px-3 py-1.5 text-sm text-success"
      >
        Send Invoice
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-lg border border-border bg-bg-elevated p-3 text-sm shadow-lg">
          <div className="flex flex-col gap-1">
            <button
              disabled={!settings || !whatsappEnabled || sending !== null}
              onClick={handleWhatsAppClick}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-card-hover disabled:opacity-40"
            >
              <span>WhatsApp</span>
              {!whatsappEnabled && settings && <span className="text-xs text-fg-muted">Disabled</span>}
              {sending === "whatsapp" && <span className="text-xs text-fg-muted">Opening...</span>}
            </button>
            <button
              disabled={!settings || sending !== null}
              onClick={() => void doSend("share_pdf")}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-card-hover disabled:opacity-40"
            >
              <span>Share PDF</span>
              {sending === "share_pdf" && <span className="text-xs text-fg-muted">Sharing...</span>}
            </button>
            {COMING_SOON_CHANNELS.map(({ channel, label }) => (
              <button key={channel} disabled className="flex items-center justify-between rounded-md px-2 py-1.5 text-left opacity-40">
                <span>{label}</span>
                <span className="text-xs text-fg-muted">Coming soon</span>
              </button>
            ))}
          </div>

          {showConfirm && (
            <div className="mt-3 border-t border-border pt-3">
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                {customerPhone ? "Confirm mobile number" : "Enter mobile number"}
              </label>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="10-digit mobile number"
                className="mb-2 w-full rounded-lg border border-border px-2 py-1.5 text-sm bg-bg-elevated"
                autoFocus
              />
              <button
                onClick={() => void doSend("whatsapp")}
                disabled={sending !== null || !isValidMobileNumber(mobile, countryCode)}
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {sending === "whatsapp" ? "Opening..." : "Open WhatsApp"}
              </button>
            </div>
          )}

          {result && (
            <p className={`mt-3 text-xs ${result.success ? "text-success" : "text-error"}`}>{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
