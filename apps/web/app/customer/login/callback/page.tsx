"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { customerApi } from "@/lib/api";
import { saveCustomerSession } from "@/lib/customerAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function CustomerGoogleCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [proof, setProof] = useState<{ ticket: string; kind: string } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish(ticket: string, kind: string, password?: string) {
    setBusy(true);
    setError(null);
    try {
      const { token, customer } = await customerApi.googleComplete(ticket, kind, password);
      saveCustomerSession({ token, customerCode: customer.code, name: customer.name });
      router.replace("/customer/reports");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in. Please try again.");
      setPassword("");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);
    const ticket = params.get("ticket");
    const kind = params.get("kind");
    /* eslint-disable react-hooks/set-state-in-effect -- consume external OAuth handoff once */
    if (!ticket || (kind !== "login" && kind !== "link")) setError("Start again from customer login.");
    else if (kind === "link") setProof({ ticket, kind });
    else void finish(ticket, kind);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <main className="flex flex-1 items-center justify-center px-4 py-10">
    <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
      <h1 className="text-xl font-semibold">{proof ? "Link your Google account" : "Customer sign-in"}</h1>
      {proof && <form onSubmit={e => { e.preventDefault(); void finish(proof.ticket, proof.kind, password); }}>
        <p className="my-4 text-sm text-fg-muted">Confirm your existing PetroPro customer password once. Future sign-ins use Google.</p>
        <label htmlFor="customer-link-password" className="text-sm">PetroPro customer password</label>
        <Input id="customer-link-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
        <Button className="mt-4 w-full" disabled={busy}>{busy ? "Signing in…" : "Link and sign in"}</Button>
      </form>}
      {!proof && !error && <p role="status" className="mt-4 text-sm">Signing in…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}
      <a href="/customer/login" className="mt-4 block text-sm text-primary underline">Back to customer login</a>
    </section>
  </main>;
}
