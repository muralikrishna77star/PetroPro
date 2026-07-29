import type { CommunicationChannel, CommunicationResult, ICommunicationProvider } from "../types";

/** Stub for channels the architecture is ready for but that have no real backend yet — WhatsApp
 *  Business API, Email, SMS. Same interface as every other provider (so CommunicationService
 *  treats it identically), always unavailable, always resolves to a "coming soon" result rather
 *  than being half-wired. Professional-edition work per
 *  PetroPro_WhatsApp_Invoice_Module_Claude_Prompt.pdf. */
export class ComingSoonProvider implements ICommunicationProvider {
  constructor(
    public channel: CommunicationChannel,
    public label: string,
  ) {}

  isAvailable(): boolean {
    return false;
  }

  async send(): Promise<CommunicationResult> {
    return { success: false, channel: this.channel, message: `${this.label} is coming soon` };
  }
}
