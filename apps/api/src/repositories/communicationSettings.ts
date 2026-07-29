import { db } from "../db/client.js";

export interface CommunicationSettings {
  whatsapp_enabled: boolean;
  default_country_code: string;
  message_template: string;
  auto_open_whatsapp: boolean;
  business_api_enabled: boolean;
}

interface CommunicationSettingsRow {
  whatsapp_enabled: number;
  default_country_code: string;
  message_template: string;
  auto_open_whatsapp: number;
  business_api_enabled: number;
}

function toSettings(row: CommunicationSettingsRow): CommunicationSettings {
  return {
    whatsapp_enabled: row.whatsapp_enabled === 1,
    default_country_code: row.default_country_code,
    message_template: row.message_template,
    auto_open_whatsapp: row.auto_open_whatsapp === 1,
    business_api_enabled: row.business_api_enabled === 1,
  };
}

export const communicationSettingsRepo = {
  get(): CommunicationSettings {
    const row = db
      .prepare(
        "SELECT whatsapp_enabled, default_country_code, message_template, auto_open_whatsapp, business_api_enabled FROM communication_settings WHERE id = 1",
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
    db.prepare(
      `UPDATE communication_settings
       SET whatsapp_enabled = ?, default_country_code = ?, message_template = ?, auto_open_whatsapp = ?, business_api_enabled = ?
       WHERE id = 1`,
    ).run(
      next.whatsapp_enabled ? 1 : 0,
      next.default_country_code,
      next.message_template,
      next.auto_open_whatsapp ? 1 : 0,
      next.business_api_enabled ? 1 : 0,
    );
    return communicationSettingsRepo.get();
  },
};
