import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const { communicationSettingsRepo } = await import("./communicationSettings.js");

test("get() returns the seeded defaults before any update", () => {
  const settings = communicationSettingsRepo.get();
  assert.equal(settings.whatsapp_enabled, true);
  assert.equal(settings.default_country_code, "91");
  assert.equal(settings.auto_open_whatsapp, true);
  assert.equal(settings.business_api_enabled, false);
  assert.match(settings.message_template, /\{customerName\}/);
});

test("update() changes only the given keys and persists across calls", () => {
  communicationSettingsRepo.update({ default_country_code: "44", whatsapp_enabled: false });
  const settings = communicationSettingsRepo.get();
  assert.equal(settings.default_country_code, "44");
  assert.equal(settings.whatsapp_enabled, false);
  // Untouched fields keep their prior value rather than resetting to schema defaults.
  assert.equal(settings.auto_open_whatsapp, true);
});
