import type { CommunicationChannel } from "@/lib/api";

export type { CommunicationChannel };

/** Everything a provider needs to build and send one invoice communication. `mobileNumber` is
 *  whatever the operator currently has typed/confirmed — may be null until they fill it in. */
export interface CommunicationSendRequest {
  billNo: number;
  customerCode: string | null;
  customerName: string | null;
  mobileNumber: string | null;
  amount: number;
  pdfUrl: string;
  pdfFilename: string;
}

/** Config a provider needs but that isn't part of the request itself — settings/tenant data
 *  loaded once by the caller (SendInvoiceButton) rather than re-fetched per provider. */
export interface CommunicationProviderContext {
  token: string;
  tenantName: string;
  messageTemplate: string;
  defaultCountryCode: string;
}

export interface CommunicationResult {
  success: boolean;
  channel: CommunicationChannel;
  /** Short, user-facing explanation — shown directly in SendInvoiceButton, not just logged. */
  message: string;
}

/** Billing -> CommunicationService -> Provider (see
 *  PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf). One implementation per channel;
 *  `isAvailable()` lets CommunicationService/SendInvoiceButton grey out channels that are
 *  architected but not yet real (WhatsApp Business API, Email, SMS — see ComingSoonProvider). */
export interface ICommunicationProvider {
  channel: CommunicationChannel;
  label: string;
  isAvailable(): boolean;
  send(request: CommunicationSendRequest, ctx: CommunicationProviderContext): Promise<CommunicationResult>;
}
