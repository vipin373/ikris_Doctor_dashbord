"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthLayout } from "../auth-layout";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function LoginPage() {
  const { signIn, session, me } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [expired, setExpired] = React.useState(false);

  React.useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).has("expired"));
  }, []);
  React.useEffect(() => {
    if (session && me) router.replace("/dashboard");
  }, [session, me, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setError(msg === "Invalid login credentials" ? "Email or password is incorrect." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold text-ink">Sign in</h2>
      <p className="mt-1 text-sm text-ink-soft">Use your Ikris Pharma Network account.</p>
      {expired && <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Your session expired. Please sign in again.</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="mb-1 text-xs font-medium text-brand-700 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button type="submit" className="w-full justify-center" disabled={busy}>
          {busy ? "Signing in…" : "Login"}
        </Button>
      </form>
      <p className="mt-8 text-xs text-ink-soft">Access is by invitation. Contact your administrator for an account.</p>
    </AuthLayout>
  );
}
