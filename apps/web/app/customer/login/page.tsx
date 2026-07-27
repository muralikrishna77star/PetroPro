"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fuel } from "lucide-react";
import { customerApi, ApiError } from "@/lib/api";
import { saveCustomerSession } from "@/lib/customerAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function CustomerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, customer } = await customerApi.login(email, password);
      saveCustomerSession({ token, customerCode: customer.code, name: customer.name });
      router.push("/customer/orders");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-secondary/20 blur-3xl" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
            <Fuel size={22} />
          </span>
          <div>
            <h1 className="font-heading text-xl font-semibold text-fg">PetroPro</h1>
            <p className="text-xs text-fg-muted">Order Entry</p>
          </div>
        </div>

        <label className="mb-1 block text-sm font-medium text-fg-muted">Email</label>
        <Input
          type="email"
          className="mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="mb-1 block text-sm font-medium text-fg-muted">Password</label>
        <Input
          type="password"
          className="mb-6"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p className="mb-4 text-sm text-error">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Signing in..." : "Sign in"}
        </Button>

        <p className="mt-4 text-center text-xs text-fg-muted">
          Don&apos;t have a password yet? Ask the station to set one up for you.
        </p>
      </form>
    </div>
  );
}
