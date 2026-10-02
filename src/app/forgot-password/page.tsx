"use client";

import * as React from "react";
import Link from "next/link";
import { AuthLayout } from "../auth-layout";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold text-ink">Reset your password</h2>
      {sent ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          If an account exists for {email}, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <Link href="/login" className="mt-6 inline-block text-xs font-medium text-brand-700 hover:underline">
        ← Back to sign in
      </Link>
    </AuthLayout>
  );
}
