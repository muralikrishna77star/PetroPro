import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { auditUserEmails, type EmailAuditUser } from "../services/userEmailAudit.js";

/**
 * Read-only review of staff email records. Selects named columns only, so no password hash is ever read.
 *   This machine's database:  npm run audit:user-emails --workspace apps/api
 *   Production, before a deploy (needs a flyctl login, changes nothing and restarts nothing):
 *                             npm run audit:user-emails --workspace apps/api -- --fly-app petropro-api
 * Opens the file directly rather than through client.ts, which would apply the schema.
 */
const USERS_SQL = "SELECT user_id, name, role, active, email FROM users ORDER BY user_id";
const CUSTOMERS_SQL = "SELECT email FROM customers WHERE email IS NOT NULL";

interface Rows {
  users: EmailAuditUser[];
  customers: string[];
}

function fromFly(app: string): Rows {
  const script =
    "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/repo/data/petropro.db',{readOnly:true});" +
    `console.log('ROWS'+JSON.stringify({users:d.prepare('${USERS_SQL}').all(),customers:d.prepare('${CUSTOMERS_SQL}').all().map(r=>r.email)}));`;
  const output = execFileSync(process.env.FLYCTL ?? "flyctl", ["ssh", "console", "-a", app, "-C", `node --no-warnings -e "${script}"`], { encoding: "utf8" });
  const line = output.split(/\r?\n/).find((l) => l.startsWith("ROWS"));
  if (!line) throw new Error(`No data came back from ${app}:\n${output.slice(-500)}`);
  return JSON.parse(line.slice(4)) as Rows;
}

function fromLocalFile(): Rows {
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  const users = db.prepare(USERS_SQL).all() as unknown as EmailAuditUser[];
  const customers = (db.prepare(CUSTOMERS_SQL).all() as unknown as { email: string }[]).map((c) => c.email);
  db.close();
  return { users, customers };
}

const flag = process.argv.indexOf("--fly-app");
const { users, customers } = flag >= 0 ? fromFly(process.argv[flag + 1]) : fromLocalFile();

const findings = auditUserEmails(users, customers);
console.log(`${users.length} users, ${users.filter((u) => u.email).length} with an email, ${findings.length} findings`);
for (const f of findings) console.log(`[${f.severity}] ${f.user_id} <${f.email ?? "none"}> ${f.kind}: ${f.message}`);
if (findings.some((f) => f.severity === "block")) process.exitCode = 1;
