import { api } from "@/lib/api";
import { WhatsAppCommunityProvider } from "./providers/WhatsAppCommunityProvider";
import { ComingSoonProvider } from "./providers/ComingSoonProvider";
import { SharePdfProvider } from "./providers/SharePdfProvider";
import type {
  CommunicationChannel,
  CommunicationProviderContext,
  CommunicationResult,
  CommunicationSendRequest,
  ICommunicationProvider,
} from "./types";

/** Billing -> CommunicationService -> Provider. Resolves a channel to its provider, sends, and
 *  logs the attempt to the backend (best-effort — a logging failure shouldn't undo a message
 *  that already went out). See PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf. */
export class CommunicationService {
  private providers: Record<CommunicationChannel, ICommunicationProvider> = {
    whatsapp: new WhatsAppCommunityProvider(),
    whatsapp_business: new ComingSoonProvider("whatsapp_business", "WhatsApp Business API"),
    email: new ComingSoonProvider("email", "Email"),
    sms: new ComingSoonProvider("sms", "SMS"),
    share_pdf: new SharePdfProvider(),
  };

  listProviders(): ICommunicationProvider[] {
    return Object.values(this.providers);
  }

  async send(
    channel: CommunicationChannel,
    request: CommunicationSendRequest,
    ctx: CommunicationProviderContext,
  ): Promise<CommunicationResult> {
    const provider = this.providers[channel];
    const result = await provider.send(request, ctx);
    api
      .logCommunication(ctx.token, {
        bill_no: request.billNo,
        customer_code: request.customerCode,
        mobile_number: request.mobileNumber,
        channel,
        status: result.success ? "sent" : "failed",
        remarks: result.message,
      })
      .catch(() => undefined);
    return result;
  }
}

export const communicationService = new CommunicationService();
