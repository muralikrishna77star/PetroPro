"use client";

import { useEffect, useState } from "react";
import { api, ApiError, downloadAuthed, type Customer, type LedgerEntry, type Receipt } from "@/lib/api";
import { useRequireSession } from "@/lib/useSession";
import { Card } from "@/components/Card";

export default function CustomersPage() {
  const session = useRequireSession(["super_admin", "owner", "operator"]);
  const canViewLedger = session?.role === "super_admin" || session?.role === "owner";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newCreditLimit, setNewCreditLimit] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMode, setReceiptMode] = useState("cash");
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);

  const [opDate, setOpDate] = useState("");
  const [opBalance, setOpBalance] = useState("");
  const [opError, setOpError] = useState<string | null>(null);
  const [opMessage, setOpMessage] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  function refreshCustomers(token: string) {
    api.listCustomers(token).then(setCustomers).catch(() => undefined);
  }

  useEffect(() => {
    if (!session) return;
    refreshCustomers(session.token);
  }, [session]);

  async function selectCustomer(customer: Customer) {
    if (!session) return;
    setSelected(customer);
    setLedger(null);
    setReceiptMessage(null);
    setLastReceipt(null);
    setOpMessage(null);
    setEmailInput(customer.email ?? "");
    setEmailError(null);
    setEmailMessage(null);
    setPasswordError(null);
    setTemporaryPassword(null);
    if (canViewLedger) {
      try {
        setLedger(await api.getCustomerLedger(session.token, customer.code));
      } catch {
        setLedger([]);
      }
    }
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setCreateError(null);
    try {
      await api.createCustomer(session.token, {
        code: newCode,
        name: newName,
        credit_limit: newCreditLimit ? Number(newCreditLimit) : 0,
      });
      setNewCode("");
      setNewName("");
      setNewCreditLimit("");
      refreshCustomers(session.token);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create customer");
    }
  }

  async function handleRecordReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !selected) return;
    setReceiptError(null);
    setReceiptMessage(null);
    try {
      const receipt = await api.createReceipt(session.token, {
        customer_code: selected.code,
        amount: Number(receiptAmount),
        mode: receiptMode,
      });
      setLastReceipt(receipt);
      setReceiptMessage("Receipt recorded.");
      setReceiptAmount("");
      refreshCustomers(session.token);
      const updated = await api.getCustomer(session.token, selected.code);
      setSelected(updated);
      if (canViewLedger) setLedger(await api.getCustomerLedger(session.token, selected.code));
    } catch (err) {
      setReceiptError(err instanceof ApiError ? err.message : "Could not record receipt");
    }
  }

  async function handleSetOpeningBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !selected) return;
    setOpError(null);
    setOpMessage(null);
    try {
      await api.setOpeningBalance(session.token, selected.code, {
        op_date: opDate,
        op_balance: Number(opBalance),
      });
      setOpMessage("Opening balance set.");
      const updated = await api.getCustomer(session.token, selected.code);
      setSelected(updated);
      refreshCustomers(session.token);
      if (canViewLedger) setLedger(await api.getCustomerLedger(session.token, selected.code));
    } catch (err) {
      setOpError(err instanceof ApiError ? err.message : "Could not set opening balance");
    }
  }

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !selected) return;
    setEmailError(null);
    setEmailMessage(null);
    try {
      const updated = await api.updateCustomer(session.token, selected.code, { ...selected, email: emailInput });
      setSelected(updated);
      setEmailMessage("Email saved.");
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : "Could not save email");
    }
  }

  async function handleSetPassword() {
    if (!session || !selected) return;
    setPasswordError(null);
    setTemporaryPassword(null);
    setSettingPassword(true);
    try {
      const result = await api.setCustomerPassword(session.token, selected.code);
      setTemporaryPassword(result.temporaryPassword);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Could not set password");
    } finally {
      setSettingPassword(false);
    }
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-8 px-4 py-8 md:grid-cols-2">
        <Card color="emerald">
          <h1 className="mb-4 text-xl font-semibold text-primary">Customers</h1>

          {(session.role === "super_admin" || session.role === "owner") && (
            <form onSubmit={handleCreateCustomer} className="mb-4 flex flex-col gap-2 rounded-lg border border-border p-3 ">
              <div className="flex gap-2">
                <input
                  placeholder="Code"
                  className="w-24 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  required
                />
                <input
                  placeholder="Name"
                  className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
                <input
                  type="number"
                  placeholder="Credit limit"
                  className="w-28 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                  value={newCreditLimit}
                  onChange={(e) => setNewCreditLimit(e.target.value)}
                />
                <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">Add</button>
              </div>
              {createError && <p className="text-sm text-error">{createError}</p>}
            </form>
          )}

          <ul className="flex flex-col gap-1">
            {customers.map((c) => (
              <li key={c.code}>
                <button
                  onClick={() => selectCustomer(c)}
                  className={`w-full rounded-lg border px-4 py-2 text-left text-sm transition-colors ${
                    selected?.code === c.code
                      ? "border-primary bg-primary/10 "
                      : "border-border hover:bg-card-hover  "
                  }`}
                >
                  <span className="font-medium">{c.code}</span> — {c.name} — due ₹{c.due_amount.toFixed(2)}
                </button>
              </li>
            ))}
            {customers.length === 0 && <li className="text-sm text-fg-muted">No customers yet.</li>}
          </ul>
        </Card>

        <Card color="emerald">
          {!selected ? (
            <p className="text-sm text-fg-muted">Select a customer to view details.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold">{selected.name} ({selected.code})</h2>
                <p className="text-sm text-fg-muted">
                  Due: ₹{selected.due_amount.toFixed(2)} · Credit limit: ₹{selected.credit_limit.toFixed(2)}
                </p>
              </div>

              <form onSubmit={handleRecordReceipt} className="rounded-lg border border-border p-3 ">
                <h3 className="mb-2 text-sm font-medium">Record a receipt</h3>
                <div className="mb-2 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                    value={receiptAmount}
                    onChange={(e) => setReceiptAmount(e.target.value)}
                    required
                  />
                  <select
                    className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                    value={receiptMode}
                    onChange={(e) => setReceiptMode(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                {receiptError && <p className="text-sm text-error">{receiptError}</p>}
                {receiptMessage && (
                  <p className="text-sm text-success">
                    {receiptMessage}{" "}
                    {lastReceipt && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadAuthed(
                            api.receiptPdfUrl(lastReceipt.rec_no),
                            session.token,
                            `receipt-${lastReceipt.rec_no}.pdf`,
                            "open",
                          )
                        }
                        className="underline"
                      >
                        Print
                      </button>
                    )}
                  </p>
                )}
                <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">Record</button>
              </form>

              {(session.role === "super_admin" || session.role === "owner") && (
                <form onSubmit={handleSetOpeningBalance} className="rounded-lg border border-border p-3 ">
                  <h3 className="mb-2 text-sm font-medium">Set opening balance</h3>
                  <div className="mb-2 flex gap-2">
                    <input
                      type="date"
                      className="rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                      value={opDate}
                      onChange={(e) => setOpDate(e.target.value)}
                      required
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Balance"
                      className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                      value={opBalance}
                      onChange={(e) => setOpBalance(e.target.value)}
                      required
                    />
                  </div>
                  {opError && <p className="text-sm text-error">{opError}</p>}
                  {opMessage && <p className="text-sm text-success">{opMessage}</p>}
                  <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">Set</button>
                </form>
              )}

              {(session.role === "super_admin" || session.role === "owner") && (
                <div className="rounded-lg border border-border p-3 ">
                  <h3 className="mb-2 text-sm font-medium">Order Entry login</h3>
                  <form onSubmit={handleSaveEmail} className="mb-2 flex gap-2">
                    <input
                      type="email"
                      placeholder="Email"
                      className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm  bg-bg-elevated"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      required
                    />
                    <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">Save</button>
                  </form>
                  {emailError && <p className="mb-2 text-sm text-error">{emailError}</p>}
                  {emailMessage && <p className="mb-2 text-sm text-success">{emailMessage}</p>}

                  <button
                    type="button"
                    onClick={handleSetPassword}
                    disabled={settingPassword || !selected.email}
                    title={!selected.email ? "Save an email first" : undefined}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    {settingPassword ? "Setting..." : "Set/reset password"}
                  </button>
                  {passwordError && <p className="mt-2 text-sm text-error">{passwordError}</p>}
                  {temporaryPassword && (
                    <p className="mt-2 text-sm text-success">
                      Temporary password: <span className="font-mono font-medium">{temporaryPassword}</span> — relay
                      this to the customer, it won&apos;t be shown again.
                    </p>
                  )}
                </div>
              )}

              {canViewLedger && (
                <div>
                  <h3 className="mb-2 text-sm font-medium">Ledger</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border ">
                          <th className="py-1.5 pr-3">Date</th>
                          <th className="py-1.5 pr-3">Description</th>
                          <th className="py-1.5 pr-3">Debit</th>
                          <th className="py-1.5 pr-3">Credit</th>
                          <th className="py-1.5 pr-3">Balance</th>
                          <th className="py-1.5 pr-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {(ledger ?? []).map((entry, i) => (
                          <tr key={i} className="border-b border-border ">
                            <td className="py-1.5 pr-3">{entry.date}</td>
                            <td className="py-1.5 pr-3">{entry.description}</td>
                            <td className="py-1.5 pr-3">{entry.debit ? `₹${entry.debit.toFixed(2)}` : ""}</td>
                            <td className="py-1.5 pr-3">{entry.credit ? `₹${entry.credit.toFixed(2)}` : ""}</td>
                            <td className="py-1.5 pr-3">₹{entry.balance.toFixed(2)}</td>
                            <td className="py-1.5 pr-3">
                              {entry.type === "receipt" && entry.ref !== null && (
                                <button
                                  onClick={() =>
                                    downloadAuthed(
                                      api.receiptPdfUrl(Number(entry.ref)),
                                      session.token,
                                      `receipt-${entry.ref}.pdf`,
                                      "open",
                                    )
                                  }
                                  className="text-primary hover:underline "
                                >
                                  Print
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {(ledger ?? []).length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-3 text-center text-fg-muted">
                              No ledger entries yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
