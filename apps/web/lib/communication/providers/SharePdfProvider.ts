import type {
  CommunicationProviderContext,
  CommunicationResult,
  CommunicationSendRequest,
  ICommunicationProvider,
} from "../types";

/** The generic "Share PDF" channel — uses the native OS share sheet (Web Share API with a file
 *  attachment) where the browser supports it, so the invoice can go to any app the operator
 *  picks, not just WhatsApp. Falls back to a plain authenticated download on browsers that don't
 *  support file sharing (most desktop browsers, as of this writing). */
export class SharePdfProvider implements ICommunicationProvider {
  channel = "share_pdf" as const;
  label = "Share PDF";

  isAvailable(): boolean {
    return true;
  }

  async send(request: CommunicationSendRequest, ctx: CommunicationProviderContext): Promise<CommunicationResult> {
    try {
      const res = await fetch(request.pdfUrl, { headers: { Authorization: `Bearer ${ctx.token}` } });
      if (!res.ok) throw new Error("PDF fetch failed");
      const blob = await res.blob();
      const file = new File([blob], request.pdfFilename, { type: "application/pdf" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: request.pdfFilename });
          return { success: true, channel: this.channel, message: "Shared" };
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            return { success: false, channel: this.channel, message: "Share cancelled" };
          }
          throw err;
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = request.pdfFilename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      return { success: true, channel: this.channel, message: "Downloaded — share it manually" };
    } catch {
      return { success: false, channel: this.channel, message: "Couldn't prepare the PDF for sharing" };
    }
  }
}
