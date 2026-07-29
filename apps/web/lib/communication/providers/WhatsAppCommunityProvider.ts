import { downloadAuthed } from "@/lib/api";
import { normalizeMobileNumber } from "../mobileNumber";
import { renderMessageTemplate } from "../template";
import type {
  CommunicationProviderContext,
  CommunicationResult,
  CommunicationSendRequest,
  ICommunicationProvider,
} from "../types";

/** Community-edition WhatsApp: no Business API, no browser automation, no unofficial WhatsApp
 *  client library — just the same wa.me deep link a person would type into their address bar,
 *  pre-filled with a thank-you message. wa.me has no way to attach a file via URL, so this also
 *  triggers a PDF download so the invoice is sitting in Downloads, ready for the operator to
 *  attach by hand once WhatsApp Web opens (see PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf). */
export class WhatsAppCommunityProvider implements ICommunicationProvider {
  channel = "whatsapp" as const;
  label = "WhatsApp";

  isAvailable(): boolean {
    return true;
  }

  async send(request: CommunicationSendRequest, ctx: CommunicationProviderContext): Promise<CommunicationResult> {
    const number = normalizeMobileNumber(request.mobileNumber, ctx.defaultCountryCode);
    if (!number) {
      return { success: false, channel: this.channel, message: "Enter a valid mobile number first" };
    }

    const message = renderMessageTemplate(ctx.messageTemplate, {
      customerName: request.customerName || "Customer",
      tenantName: ctx.tenantName,
      billNo: request.billNo,
      amount: request.amount.toFixed(2),
    });
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

    // Deliberately not passing "noopener" in the features string, even though we want the same
    // security effect (no reverse-tabnabbing via the new tab's window.opener): some engines
    // return null from window.open() whenever "noopener" is set, which would make the
    // popup-blocked check below misfire on every successful send, not just genuinely blocked
    // ones. win.opener = null right after achieves the same isolation without that risk.
    const win = window.open(url, "_blank", "noreferrer");
    if (!win) {
      return {
        success: false,
        channel: this.channel,
        message: "Your browser blocked the WhatsApp popup — allow popups for this site and try again",
      };
    }
    win.opener = null;

    try {
      await downloadAuthed(request.pdfUrl, ctx.token, request.pdfFilename, "save");
    } catch {
      // Non-fatal — WhatsApp Web already opened; the operator can still fetch the PDF via the
      // page's own "Print Bill" button if this particular download attempt failed.
    }

    return {
      success: true,
      channel: this.channel,
      message: "WhatsApp Web opened — attach the downloaded invoice PDF before sending",
    };
  }
}
