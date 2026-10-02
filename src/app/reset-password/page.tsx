"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "../auth-layout";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const client = supabase();
    client.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = client.auth.onAuthStateChange((_e, s) => setReady(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    const { error: err } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else router.replace("/dashboard");
  };

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold text-ink">Set a new password</h2>
      {!ready ? (
        <p className="mt-4 text-sm text-ink-soft">Open this page from the link in your email. The link may have expired; request a new one from “Forgot password”.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="pw">New password</Label>
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pw2">Confirm password</Label>
            <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
