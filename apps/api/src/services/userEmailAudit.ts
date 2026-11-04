/**
 * Reviews staff email records before Google sign-in relies on them. It takes only ids, names, roles
 * and addresses: password hashes and other credentials never reach it.
 */
export interface EmailAuditUser {
  user_id: string;
  name: string;
  role: string;
  active: number;
  email: string | null;
}

export type EmailFindingKind =
  | "no_email"
  | "invalid_format"
  | "not_normalized"
  | "duplicate"
  | "shared_with_customer"
  | "shared_mailbox"
  | "placeholder_domain"
  | "inactive_with_email"
  | "name_mismatch";

export interface EmailFinding {
  kind: EmailFindingKind;
  /** "block" must be fixed before relying on Google sign-in. "review" needs a person's judgment. "info" is for awareness. */
  severity: "block" | "review" | "info";
  user_id: string;
  email: string | null;
  message: string;
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const SHARED_MAILBOXES = new Set(["admin", "accounts", "account", "billing", "contact", "info", "office", "sales", "support", "team", "hello", "manager"]);
const PLACEHOLDER_DOMAINS = /(^|\.)(example\.(com|org|net)|test|invalid|localhost|mailinator\.com)$/;

function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

/** Whether an address plausibly belongs to this name or id. A hint for a person, never proof. */
function nameMatches(user: EmailAuditUser, localPart: string): boolean {
  const local = letters(localPart);
  const words = user.name.split(/\s+/).map(letters).filter((w) => w.length >= 3);
  const id = letters(user.user_id);
  return (id.length >= 3 && local.includes(id)) || words.some((w) => local.includes(w) || (local.length >= 4 && w.includes(local)));
}

export function auditUserEmails(users: EmailAuditUser[], customerEmails: string[] = []): EmailFinding[] {
  const findings: EmailFinding[] = [];
  const add = (user: EmailAuditUser, kind: EmailFindingKind, severity: EmailFinding["severity"], message: string) =>
    findings.push({ kind, severity, user_id: user.user_id, email: user.email, message });

  const owners = new Map<string, EmailAuditUser[]>();
  for (const user of users) {
    if (!user.email) continue;
    const key = user.email.trim().toLowerCase();
    owners.set(key, [...(owners.get(key) ?? []), user]);
  }
  const customers = new Set(customerEmails.map((e) => e.trim().toLowerCase()));

  for (const user of users) {
    if (!user.email) {
      if (user.active) add(user, "no_email", "info", "No email on file, so this user can only sign in with a password");
      continue;
    }
    const normalized = user.email.trim().toLowerCase();
    if (user.email !== normalized) {
      add(user, "not_normalized", "block", "Has capitals or spaces, so a Google sign-in wouldn't match it. Re-save it on the Users screen");
    }
    if (!EMAIL_FORMAT.test(normalized)) {
      add(user, "invalid_format", "block", "Isn't a valid email address");
      continue;
    }
    const others = (owners.get(normalized) ?? []).filter((o) => o.user_id !== user.user_id);
    if (others.length > 0) add(user, "duplicate", "block", `Same address as ${others.map((o) => o.user_id).join(", ")}`);
    if (customers.has(normalized)) add(user, "shared_with_customer", "review", "Same address as a customer portal account. Separate logins, but confirm it's the same person");

    const [localPart, domain] = normalized.split("@");
    if (PLACEHOLDER_DOMAINS.test(domain)) add(user, "placeholder_domain", "block", "Looks like a test address, not a real mailbox");
    if (SHARED_MAILBOXES.has(localPart)) add(user, "shared_mailbox", "review", "Looks like a shared mailbox. Anyone with that Google account plus this password could link it");
    else if (!nameMatches(user, localPart)) add(user, "name_mismatch", "review", `Address doesn't resemble "${user.name}". Confirm it's theirs`);
    if (!user.active) add(user, "inactive_with_email", "info", "Deactivated user with an email on file. Sign-in is refused regardless");
  }
  return findings;
}
