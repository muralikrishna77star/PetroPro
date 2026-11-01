import { db } from "../db/client.js";

export interface CommunicationSettings {
  whatsapp_enabled: boolean;
  default_country_code: string;
  message_template: string;
  auto_open_whatsapp: boolean;
  business_api_enabled: boolean;
  /** Offer "Send to my WhatsApp" on the page a customer's phone opens from the QR code. */
  qr_whatsapp_enabled: boolean;
  /** How long the bill link sent that way stays valid. */
  qr_whatsapp_link_days: number;
}

interface CommunicationSettingsRow {
  whatsapp_enabled: number;
  default_country_code: string;
  message_template: string;
  auto_open_whatsapp: number;
  business_api_enabled: number;
  qr_whatsapp_enabled: number;
  qr_whatsapp_link_days: number;
}

function toSettings(row: CommunicationSettingsRow): CommunicationSettings {
  return {
    whatsapp_enabled: row.whatsapp_enabled === 1,
    default_country_code: row.default_country_code,
    message_template: row.message_template,
    auto_open_whatsapp: row.auto_open_whatsapp === 1,
    business_api_enabled: row.business_api_enabled === 1,
    qr_whatsapp_enabled: row.qr_whatsapp_enabled === 1,
    qr_whatsapp_link_days: row.qr_whatsapp_link_days,
  };
}

export const communicationSettingsRepo = {
  get(): CommunicationSettings {
    const row = db
      .prepare(
        `SELECT whatsapp_enabled, default_country_code, message_template, auto_open_whatsapp, business_api_enabled,
                qr_whatsapp_enabled, qr_whatsapp_link_days
         FROM communication_settings WHERE id = 1`,
      )
      .get() as unknown as CommunicationSettingsRow;
    return toSettings(row);
  },

  /** Partial update — only the given keys change, matching settingsRepo.setMany()'s shape for
   *  the legacy operational flags. business_api_enabled is accepted but has no effect anywhere
   *  yet (Professional edition isn't built); stored purely for forward compatibility. */
  update(input: Partial<CommunicationSettings>): CommunicationSettings {
    const current = communicationSettingsRepo.get();
    const next = { ...current, ...input };
    const linkDays = Math.trunc(Number(next.qr_whatsapp_link_days));
    if (!Number.isFinite(linkDays) || linkDays < 1 || linkDays > 90) {
      throw new Error("QR WhatsApp link validity must be between 1 and 90 days");
    }
    db.prepare(
      `UPDATE communication_settings
       SET whatsapp_enabled = ?, default_country_code = ?, message_template = ?, auto_open_whatsapp = ?, business_api_enabled = ?,
           qr_whatsapp_enabled = ?, qr_whatsapp_link_days = ?
       WHERE id = 1`,
    ).run(
      next.whatsapp_enabled ? 1 : 0,
      next.default_country_code,
      next.message_template,
      next.auto_open_whatsapp ? 1 : 0,
      next.business_api_enabled ? 1 : 0,
      next.qr_whatsapp_enabled ? 1 : 0,
      linkDays,
    );
    return communicationSettingsRepo.get();
  },
};
