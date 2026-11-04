import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
process.env.DB_PATH = ":memory:";
const { db } = await import("../db/client.js");
const { applySchema } = await import("../db/schema.js");
const { customersRepo } = await import("../repositories/customers.js");
const { buildApp } = await import("../app.js");
const app = await buildApp(); app.log.level = 'silent';
test.after(() => app.close());
const create = (code: string, style?: 'legacy' | 'modern') => customersRepo.create({ code, name: code, report_style: style } as never);
create('NEW'); create('IMPORTED', 'legacy'); create('OTHER', 'legacy');
const token = app.jwt.sign({ sub: 'IMPORTED', role: 'customer', name: 'Imported' });
const preference = (report_style: string, extra = {}) => app.inject({ method: 'PUT', url: '/customer/report-style', headers: { authorization: `Bearer ${token}` }, payload: { report_style, ...extra } });

test('existing rows migrate to legacy; repeated migration preserves a modern opt-in', () => {
  const old = new DatabaseSync(':memory:');
  old.exec("CREATE TABLE customers (code TEXT PRIMARY KEY, name TEXT); INSERT INTO customers VALUES ('OLD', 'Old customer');");
  applySchema(old);
  assert.equal(old.prepare("SELECT report_style FROM customers WHERE code='OLD'").get()?.report_style, 'legacy');
  old.exec("UPDATE customers SET report_style='modern' WHERE code='OLD'");
  applySchema(old);
  assert.equal(old.prepare("SELECT report_style FROM customers WHERE code='OLD'").get()?.report_style, 'modern');
  old.close();
});
test('new customer defaults to modern; explicit legacy import defaults to legacy', () => {
  assert.equal(customersRepo.get('NEW')?.report_style, 'modern');
  assert.equal(customersRepo.get('IMPORTED')?.report_style, 'legacy');
});
test('customer opts in to modern or returns to legacy without affecting another account', async () => {
  const changed = await preference('modern', { customer_code: 'OTHER' });
  assert.equal(changed.statusCode, 200);
  assert.equal(customersRepo.get('IMPORTED')?.report_style, 'modern');
  assert.equal(customersRepo.get('OTHER')?.report_style, 'legacy');
  assert.equal((await preference('legacy')).statusCode, 200);
  assert.equal(customersRepo.get('IMPORTED')?.report_style, 'legacy');
  const report = await app.inject({ method: 'GET', url: '/customer/reports?from=2026-11-01&to=2026-11-30', headers: { authorization: `Bearer ${token}` } });
  assert.equal(report.json().report_style, 'legacy');
  assert.equal((await preference('invalid')).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/customer/report-style', payload: { report_style: 'modern' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: '/customers/OTHER/report-style', headers: { authorization: `Bearer ${token}` }, payload: { report_style: 'legacy' } })).statusCode, 403);
});
test('ordinary contact edits preserve the selected reporting style', () => {
  const before = customersRepo.get('IMPORTED')!;
  customersRepo.update('IMPORTED', { ...before, email: 'new@gmail.com' });
  assert.equal(customersRepo.get('IMPORTED')?.report_style, 'legacy');
});
