"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, Pagination, Skeleton, StatCard, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { MESSAGE_STATUS_TONE } from "@/lib/fda";
import { formatDateTime, number } from "@/lib/utils";

interface Log {
  id: number; channel: "WHATSAPP" | "EMAIL"; recipient: string; subject: string | null; message_text: string; status: string; error: string | null;
  provider: string; provider_message_id: string | null; sent_at: string | null; delivered_at: string | null; read_at: string | null; failed_at: string | null;
  created_at: string; template_version: number | null; doctor: { doctor_name: string; institute: string | null } | null; drug: { drug_name: string } | null;
}

export function SentMessages() {
  const [status, setStatus] = React.useState("");
  const [channel, setChannel] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<Log | null>(null);
  const logs = useQuery({
    queryKey: ["fda-messages", status, channel, page],
    queryFn: () => api.get<{ items: Log[]; total: number }>("/messages", { status, channel, page, page_size: 25 }),
    refetchInterval: 30000,
  });
  const stats = useQuery({ queryKey: ["fda-analytics"], queryFn: () => api.get<{ total: number; by_channel: Record<string, Record<string, number>> }>("/analytics", { days: 30 }) });
  const wa = stats.data?.by_channel.WHATSAPP ?? {};
  const em = stats.data?.by_channel.EMAIL ?? {};
  const sum = (o: Record<string, number>, ks: string[]) => ks.reduce((n, k) => n + (o[k] ?? 0), 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Messages (30 days)" value={number(stats.data?.total)} />
        <StatCard label="WhatsApp sent" value={number(sum(wa, ["SENT", "DELIVERED", "READ"]))} tone="green" />
        <StatCard label="WhatsApp delivered" value={number(sum(wa, ["DELIVERED", "READ"]))} tone="green" hint="From Cunnekt delivery receipts" />
        <StatCard label="WhatsApp read" value={number(wa.READ)} tone="sky" />
        <StatCard label="Emails sent" value={number(sum(em, ["SENT"]))} tone="green" hint="Accepted by the mail server" />
        <StatCard label="Failed" value={number((wa.FAILED ?? 0) + (em.FAILED ?? 0))} tone="red" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} className="w-auto"><option value="">All channels</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-auto">
            <option value="">All statuses</option>{["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "REJECTED"].map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
          </Select>
        </div>
        {logs.error ? <div className="p-4"><ErrorState error={logs.error} /></div> : logs.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !logs.data?.items.length ? (
          <EmptyState title="No messages sent yet" description="Messages appear here once they are approved and sent." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Doctor</Th><Th>FDA drug</Th><Th>Channel</Th><Th>Status</Th><Th>Sent</Th><Th>Provider ID</Th></tr></thead>
                <tbody>
                  {logs.data.items.map((l) => (
                    <tr key={l.id} onClick={() => setOpen(l)} className="cursor-pointer hover:bg-slate-50/70">
                      <Td><p className="font-medium">{l.doctor?.doctor_name}</p><p className="text-[11px] text-ink-soft">{l.recipient}</p></Td>
                      <Td className="text-xs">{l.drug?.drug_name ?? "—"}</Td>
                      <Td className="text-xs">{l.channel === "WHATSAPP" ? <MessageCircle className="mr-1 inline h-3.5 w-3.5" /> : <Mail className="mr-1 inline h-3.5 w-3.5" />}{l.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</Td>
                      <Td><Badge tone={MESSAGE_STATUS_TONE[l.status] ?? "neutral"}>{l.status[0] + l.status.slice(1).toLowerCase()}</Badge>{l.error && <p className="mt-0.5 max-w-[260px] text-[11px] text-red-700">{l.error}</p>}</Td>
                      <Td className="whitespace-nowrap text-xs text-ink-soft">{formatDateTime(l.sent_at || l.created_at)}</Td>
                      <Td className="max-w-[160px] truncate font-mono text-[11px] text-ink-soft">{l.provider_message_id ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={logs.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)} wide title={`${open.doctor?.doctor_name ?? ""} · ${open.channel === "WHATSAPP" ? "WhatsApp" : "Email"}`}
          description={`Exactly as sent${open.template_version ? ` (template v${open.template_version})` : ""}. Sent messages cannot be changed.`}>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <p><span className="text-ink-soft">Sent</span><br />{formatDateTime(open.sent_at)}</p>
              <p><span className="text-ink-soft">Delivered</span><br />{formatDateTime(open.delivered_at)}</p>
              <p><span className="text-ink-soft">Read</span><br />{formatDateTime(open.read_at)}</p>
              <p><span className="text-ink-soft">Failed</span><br />{formatDateTime(open.failed_at)}</p>
            </div>
            {open.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">Provider error: {open.error}</p>}
            {open.channel === "EMAIL" ? (
              <div className="rounded-md border border-line">
                <div className="border-b border-line bg-slate-50 px-3 py-2 text-xs">Subject: <b>{open.subject}</b></div>
                <iframe title="Sent email" sandbox="" className="h-72 w-full" srcDoc={`<!doctype html><html><body style="font-family:Arial;font-size:14px;padding:12px">${open.message_text}</body></html>`} />
              </div>
            ) : <div className="whitespace-pre-wrap rounded-md border border-emerald-100 bg-emerald-50/50 p-3">{open.message_text}</div>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
