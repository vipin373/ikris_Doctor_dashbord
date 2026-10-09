"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface Settings { schedule: "daily" | "weekly" | "manual"; sender: { name: string; phone: string; email: string }; tokens: Record<string, string> }

export function FdaSettingsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["fda-settings"], queryFn: () => api.get<Settings>("/fda/settings") });
  const [form, setForm] = React.useState<Settings | null>(null);
  const [secret, setSecret] = React.useState<{ kind: string; token: string; webhook_url?: string; endpoint?: string } | null>(null);
  React.useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
  const save = useMutation({
    mutationFn: () => api.put("/fda/settings", { schedule: form!.schedule, sender: form!.sender }),
    onSuccess: () => { toast.success("FDA settings saved"); qc.invalidateQueries({ queryKey: ["fda-settings"] }); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const token = useMutation({
    mutationFn: (kind: "automation" | "webhook") => api.post<{ kind: string; token: string; webhook_url?: string; endpoint?: string }>("/fda/settings/token", { kind }),
    onSuccess: (r) => { setSecret(r); qc.invalidateQueries({ queryKey: ["fda-settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success("Copied"); };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="FDA settings"
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!form || save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {!form ? <Skeleton className="h-48" /> : (
        <div className="space-y-5 text-sm">
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Automatic FDA updates</p>
            <Select value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value as Settings["schedule"] })} className="max-w-xs">
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual only</option>
            </Select>
            <p className="text-xs text-ink-soft">The scheduled job (Vercel cron or n8n) calls the FDA sync endpoint every day and only runs when this schedule says it is due. Scheduled runs fetch only labels changed since the last sync.</p>
          </section>
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Sender details (for {"{{sender_name}}, {{sender_phone}}, {{sender_email}}"})</p>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Name</Label><Input value={form.sender.name} onChange={(e) => setForm({ ...form, sender: { ...form.sender, name: e.target.value } })} /></div>
              <div><Label>Phone</Label><Input value={form.sender.phone} onChange={(e) => setForm({ ...form, sender: { ...form.sender, phone: e.target.value } })} /></div>
              <div><Label>Email</Label><Input value={form.sender.email} onChange={(e) => setForm({ ...form, sender: { ...form.sender, email: e.target.value } })} /></div>
            </div>
          </section>
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Connections</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={token.isPending} onClick={() => token.mutate("webhook")}><KeyRound className="h-3.5 w-3.5" /> {data?.tokens?.webhook_token ? "New" : "Create"} Cunnekt webhook URL</Button>
              <span className="text-xs text-ink-soft">{data?.tokens?.webhook_token ? `Last created ${formatDateTime(data.tokens.webhook_token)}` : "Needed for Delivered / Read statuses"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={token.isPending} onClick={() => token.mutate("automation")}><KeyRound className="h-3.5 w-3.5" /> {data?.tokens?.automation_token ? "New" : "Create"} automation token (n8n / cron)</Button>
              <span className="text-xs text-ink-soft">{data?.tokens?.automation_token ? `Set ${formatDateTime(data.tokens.automation_token)}. The Vercel cron uses it as CRON_SECRET; if you replace it, update CRON_SECRET on Vercel too.` : "Needed for scheduled FDA sync"}</span>
            </div>
            {secret && (
              <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Copy this now. It is shown only once; creating a new one replaces it.</p>
                {secret.webhook_url ? (
                  <><p>Paste into Cunnekt → API Settings → Webhook URL:</p><Row value={secret.webhook_url} onCopy={copy} /></>
                ) : (
                  <><p>Call <b>{secret.endpoint}</b> with header <b>X-Automation-Token</b>:</p><Row value={secret.token} onCopy={copy} /></>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function Row({ value, onCopy }: { value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-[11px] text-ink">{value}</code>
      <Button size="icon" variant="ghost" aria-label="Copy" onClick={() => onCopy(value)}><Copy className="h-3.5 w-3.5" /></Button>
    </div>
  );
}
