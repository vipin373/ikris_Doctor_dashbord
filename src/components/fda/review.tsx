"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, Info, Loader2, Mail, MessageCircle, Pencil, RefreshCw, Send, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, ErrorState, Skeleton, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { CHANNEL_LABEL, MESSAGE_STATUS_TONE, type CampaignDetail, type GeneratedMessage } from "@/lib/fda";
import { cn, formatDateTime } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ready to approve", NEEDS_REVIEW: "Needs review", APPROVED: "Approved", REJECTED: "Rejected", SENT: "Sent", FAILED: "Failed",
};

export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api.get<CampaignDetail>(`/campaigns/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const msgs = q.state.data?.messages ?? [];
      return msgs.some((m) => m.status === "SENT" && m.delivery && ["SENT", "QUEUED"].includes(m.delivery.status) && m.channel === "WHATSAPP") ? 15000 : false;
    },
  });
}

/** Generates drafts for all pending doctors, a batch at a time. */
export async function generateAll(id: string, onProgress: (done: number, pending: number) => void, manual?: { subject?: string; body: string }) {
  let made = 0;
  for (let i = 0; i < 200; i++) {
    const r = await api.post<{ generated: number; pending: number; done: boolean }>(`/campaigns/${id}/generate`, {
      limit: 10, ...(manual ? { manual_subject: manual.subject ?? null, manual_body: manual.body } : {}),
    });
    made += r.generated;
    onProgress(made, r.pending);
    if (r.done) return made;
  }
  return made;
}

export function deliveryLabel(m: GeneratedMessage): { text: string; tone: "green" | "red" | "neutral" | "amber" | "brand" } {
  const d = m.delivery;
  if (!d) return { text: STATUS_LABEL[m.status] ?? m.status, tone: (MESSAGE_STATUS_TONE[m.status] as never) ?? "neutral" };
  if (d.status === "READ") return { text: `Read ${formatDateTime(d.read_at)}`, tone: "green" };
  if (d.status === "DELIVERED") return { text: `Delivered ${formatDateTime(d.delivered_at)}`, tone: "green" };
  if (d.status === "SENT") return { text: m.channel === "EMAIL" ? `Sent (accepted by mail server) ${formatDateTime(d.sent_at)}` : `Sent ${formatDateTime(d.sent_at)}`, tone: "green" };
  if (d.status === "FAILED") return { text: "Failed", tone: "red" };
  return { text: d.status, tone: "neutral" };
}

export function CampaignReview({ id, single }: { id: string; single?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useCampaign(id);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<GeneratedMessage | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [sending, setSending] = React.useState<{ sent: number; failed: number; total: number } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["campaign", id] });

  const approve = useMutation({
    mutationFn: (p: { ids: string[]; action: "APPROVE" | "REJECT" }) => api.post<{ changed: number; note: string | null }>(`/campaigns/${id}/approve`, { message_ids: p.ids, action: p.action }),
    onSuccess: (r, p) => {
      toast.success(`${r.changed} message${r.changed === 1 ? "" : "s"} ${p.action === "APPROVE" ? "approved" : "rejected"}`, { description: r.note ?? undefined });
      setSelected(new Set());
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-40" />;

  const docById = new Map(data.doctors.map((d) => [d.doctor_id, d]));
  const msgs = data.messages;
  const approvable = msgs.filter((m) => ["DRAFT", "FAILED"].includes(m.status)).map((m) => m.id);
  const approved = msgs.filter((m) => m.status === "APPROVED");
  const skipped = data.doctors.filter((d) => d.status === "SKIPPED");

  const runSend = async () => {
    setConfirm(false);
    const total = approved.length;
    const acc = { sent: 0, failed: 0, total };
    setSending({ ...acc });
    try {
      for (let i = 0; i < 300; i++) {
        const r = await api.post<{ results: { status: string; error?: string }[]; remaining: number }>(`/campaigns/${id}/send`, { confirm: true, limit: 15 });
        acc.sent += r.results.filter((x) => x.status === "SENT").length;
        acc.failed += r.results.filter((x) => x.status !== "SENT").length;
        setSending({ ...acc });
        const err = r.results.find((x) => x.error)?.error;
        if (err && r.results.length === 1) toast.error(single ? err : `Some messages failed: ${err}`);
        if (r.remaining === 0 || r.results.length === 0) break;
      }
      toast[acc.failed ? "warning" : "success"](`${acc.sent} sent${acc.failed ? `, ${acc.failed} not sent (see the status column)` : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(null);
      refresh();
      qc.invalidateQueries({ queryKey: ["fda-messages"] });
    }
  };

  const toggle = (mid: string) => setSelected((s) => { const n = new Set(s); if (n.has(mid)) n.delete(mid); else n.add(mid); return n; });

  return (
    <Card>
      <CardHeader
        title={single ? "Preview & approve" : "Review"}
        description={`${msgs.length} message${msgs.length === 1 ? "" : "s"} · ${data.counts.APPROVED ?? 0} approved · ${data.counts.NEEDS_REVIEW ?? 0} need review · ${data.counts.SENT ?? 0} sent`}
        action={
          <div className="flex flex-wrap gap-2">
            {!single && approvable.length > 0 && (
              <Button size="sm" variant="outline" disabled={approve.isPending} onClick={() => approve.mutate({ ids: selected.size ? Array.from(selected) : approvable, action: "APPROVE" })}>
                <Check className="h-3.5 w-3.5" /> {selected.size ? `Approve selected (${selected.size})` : `Approve all ready (${approvable.length})`}
              </Button>
            )}
            {!single && selected.size > 0 && (
              <Button size="sm" variant="outline" onClick={() => approve.mutate({ ids: Array.from(selected), action: "REJECT" })}><X className="h-3.5 w-3.5" /> Reject selected</Button>
            )}
            <Button size="sm" disabled={!approved.length || !!sending} onClick={() => setConfirm(true)}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send approved ({approved.length})
            </Button>
          </div>
        }
      />
      {sending && (
        <div className="border-b border-line px-5 py-2 text-xs text-ink-soft">Sending… {sending.sent + sending.failed} of {sending.total} processed ({sending.sent} sent).</div>
      )}
      {skipped.length > 0 && (
        <details className="border-b border-line px-5 py-2 text-xs text-ink-muted">
          <summary className="cursor-pointer">{skipped.length} doctor{skipped.length === 1 ? "" : "s"} skipped (not matched, not eligible or missing contact)</summary>
          <ul className="mt-1.5 space-y-0.5">{skipped.slice(0, 100).map((s) => <li key={s.id}><b>{s.doctor?.doctor_name}</b>: {s.skip_reason}</li>)}</ul>
        </details>
      )}
      {single ? (
        <div className="divide-y divide-line">
          {msgs.map((m) => <SingleMessageCard key={m.id} m={m} campaignId={id} onPreview={() => setPreview(m)} onApprove={() => approve.mutate({ ids: [m.id], action: "APPROVE" })} busy={approve.isPending} />)}
          {!msgs.length && <p className="px-5 py-6 text-sm text-ink-soft">{skipped[0]?.skip_reason ?? "No message was generated."}</p>}
        </div>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th className="w-8"><input type="checkbox" aria-label="Select all" checked={approvable.length > 0 && approvable.every((x) => selected.has(x))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(approvable) : new Set())} /></Th>
                <Th>Doctor</Th><Th>Department</Th><Th>FDA drug</Th><Th>Channel</Th><Th>Status</Th><Th>Approval</Th><Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {msgs.map((m) => {
                const cd = docById.get(m.doctor_id);
                const dl = deliveryLabel(m);
                const blocked = m.issues.filter((i) => i.level === "block");
                return (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <Td><input type="checkbox" disabled={!["DRAFT", "FAILED", "APPROVED", "NEEDS_REVIEW"].includes(m.status)} checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label="Select" /></Td>
                    <Td>
                      <p className="font-medium text-ink">{cd?.doctor?.must_see && <Star className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-400" />}{cd?.doctor?.doctor_name}</p>
                      <p className="text-[11px] text-ink-soft">{cd?.doctor?.institute ?? ""}</p>
                    </Td>
                    <Td className="text-xs">{cd?.doctor?.sub_department ?? cd?.department}</Td>
                    <Td className="text-xs">{cd?.drug?.drug_name ?? "—"}<p className="text-[11px] text-ink-soft">{cd?.match_reason}</p></Td>
                    <Td className="text-xs">{m.channel === "WHATSAPP" ? <MessageCircle className="mr-1 inline h-3.5 w-3.5" /> : <Mail className="mr-1 inline h-3.5 w-3.5" />}{CHANNEL_LABEL[m.channel]}</Td>
                    <Td>
                      <Badge tone={dl.tone}>{dl.text}</Badge>
                      {m.delivery?.error && <p className="mt-0.5 max-w-[220px] text-[11px] text-red-700">{m.delivery.error}</p>}
                      {blocked.length > 0 && m.status === "NEEDS_REVIEW" && <p className="mt-0.5 max-w-[220px] text-[11px] text-amber-800">{blocked[0].text}</p>}
                    </Td>
                    <Td className="text-xs text-ink-soft">{m.approved_at ? formatDateTime(m.approved_at) : "—"}</Td>
                    <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setPreview(m)}><Eye className="h-3.5 w-3.5" /> Preview</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview && <MessageDialog m={msgs.find((x) => x.id === preview.id) ?? preview} campaignId={id} doctorName={docById.get(preview.doctor_id)?.doctor?.doctor_name}
        drugName={docById.get(preview.doctor_id)?.drug?.drug_name} onClose={() => setPreview(null)}
        onApprove={(mid, action) => approve.mutate({ ids: [mid], action })} />}

      <Dialog open={confirm} onOpenChange={setConfirm} title="Send approved messages?"
        description="Messages go out through Cunnekt (WhatsApp) and email exactly as approved. This cannot be undone."
        footer={<><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={runSend}>Confirm Send</Button></>}>
        <SendSummary id={id} />
      </Dialog>
    </Card>
  );
}

function SendSummary({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["send-summary", id],
    queryFn: () => api.get<{ whatsapp: number; email: number; total: number; whatsapp_configured: boolean; email_configured: boolean; email_missing: string[] }>(`/campaigns/${id}/send-summary`),
  });
  if (!data) return <Skeleton className="h-16" />;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-ink">You are about to send:</p>
      <ul className="space-y-0.5 tabular-nums">
        <li>WhatsApp: <b>{data.whatsapp}</b></li>
        <li>Email: <b>{data.email}</b></li>
        <li>Total: <b>{data.total}</b></li>
      </ul>
      {data.whatsapp > 0 && !data.whatsapp_configured && <p className="text-xs text-red-700">WhatsApp is not configured on the server (CUNNEKT_API_KEY); those messages will fail.</p>}
      {data.email > 0 && !data.email_configured && <p className="text-xs text-red-700">Email is not configured on the server (missing {data.email_missing.join(", ")}); those messages will fail.</p>}
      <p className="text-xs text-ink-soft">Doctors still inside their contact-frequency window are skipped automatically.</p>
    </div>
  );
}

function IssueList({ m }: { m: GeneratedMessage }) {
  if (!m.issues?.length) return null;
  return (
    <div className="space-y-1">
      {m.issues.map((i, n) => (
        <p key={n} className={cn("flex items-start gap-1.5 rounded px-2 py-1 text-xs", i.level === "block" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-ink-muted")}>
          {i.level === "block" ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> : <Info className="mt-0.5 h-3 w-3 shrink-0" />}{i.text}
        </p>
      ))}
    </div>
  );
}

function MessageBody({ m }: { m: GeneratedMessage }) {
  if (m.channel === "EMAIL") {
    return (
      <div className="rounded-md border border-line">
        <div className="border-b border-line bg-slate-50 px-3 py-2 text-xs"><span className="text-ink-soft">Subject: </span><b className="text-ink">{m.subject || "—"}</b></div>
        <iframe title="Email preview" sandbox="" className="h-72 w-full bg-white"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;padding:14px;margin:0}</style></head><body>${m.body}</body></html>`} />
      </div>
    );
  }
  return <div className="whitespace-pre-wrap rounded-md border border-emerald-100 bg-emerald-50/50 p-3 text-sm text-ink">{m.body || <span className="text-ink-soft">Empty</span>}</div>;
}

function SingleMessageCard({ m, campaignId, onPreview, onApprove, busy }: { m: GeneratedMessage; campaignId: string; onPreview: () => void; onApprove: () => void; busy: boolean }) {
  const dl = deliveryLabel(m);
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{m.channel === "WHATSAPP" ? <MessageCircle className="mr-1 inline h-4 w-4" /> : <Mail className="mr-1 inline h-4 w-4" />}{CHANNEL_LABEL[m.channel]}</p>
        <Badge tone={dl.tone}>{dl.text}</Badge>
      </div>
      {m.delivery?.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{m.channel === "WHATSAPP" ? "WhatsApp message failed." : "Email could not be sent."} Provider error: {m.delivery.error}</p>}
      <IssueList m={m} />
      <MessageBody m={m} />
      {m.status !== "SENT" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onPreview}><Pencil className="h-3.5 w-3.5" /> Edit / Regenerate</Button>
          {["DRAFT", "FAILED"].includes(m.status) && <Button size="sm" variant="secondary" disabled={busy} onClick={onApprove}><Check className="h-3.5 w-3.5" /> Approve</Button>}
        </div>
      )}
      <span className="hidden">{campaignId}</span>
    </div>
  );
}

function MessageDialog({ m, campaignId, doctorName, drugName, onClose, onApprove }: {
  m: GeneratedMessage; campaignId: string; doctorName?: string; drugName?: string; onClose: () => void;
  onApprove: (id: string, action: "APPROVE" | "REJECT") => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [subject, setSubject] = React.useState(m.subject ?? "");
  const [body, setBody] = React.useState(m.body);
  React.useEffect(() => { setSubject(m.subject ?? ""); setBody(m.body); }, [m.subject, m.body]);
  const done = () => qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
  const save = useMutation({
    mutationFn: () => api.put(`/messages/${m.id}`, { subject: m.channel === "EMAIL" ? subject : null, body }),
    onSuccess: () => { toast.success("Saved. Approve it to send."); setEditing(false); done(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const regen = useMutation({
    mutationFn: () => api.post(`/messages/${m.id}/regenerate`, {}),
    onSuccess: () => { toast.success("Regenerated"); done(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "AI generation failed."),
  });
  const sent = m.status === "SENT";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`${doctorName ?? "Doctor"} · ${CHANNEL_LABEL[m.channel]}`}
      description={`${drugName ? `FDA drug: ${drugName} · ` : ""}${m.method === "AI" ? "AI draft" : m.method === "TEMPLATE" ? `Template v${m.template_version ?? "?"}` : "Written manually"} · ${STATUS_LABEL[m.status] ?? m.status}`}
      footer={sent ? <Button variant="outline" onClick={onClose}>Close</Button> : (
        <>
          {editing ? (
            <><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
              {m.method !== "MANUAL" && <Button variant="outline" disabled={regen.isPending} onClick={() => regen.mutate()}>{regen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate</Button>}
              {m.status !== "REJECTED" && <Button variant="outline" onClick={() => { onApprove(m.id, "REJECT"); onClose(); }}>Reject</Button>}
              <Button disabled={!["DRAFT", "FAILED", "REJECTED"].includes(m.status)} onClick={() => { onApprove(m.id, "APPROVE"); onClose(); }}><Check className="h-3.5 w-3.5" /> Approve</Button>
            </>
          )}
        </>
      )}>
      <div className="space-y-3">
        <IssueList m={m} />
        {m.delivery?.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">Provider error: {m.delivery.error}</p>}
        {editing ? (
          <>
            {m.channel === "EMAIL" && <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></div>}
            <div>
              <Label>{m.channel === "EMAIL" ? "Body (HTML or plain text)" : "Message"}</Label>
              <Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} className={m.channel === "EMAIL" ? "font-mono text-[12px]" : ""} />
              <p className="mt-1 text-[11px] text-ink-soft">Do not add FDA facts that are not in the FDA record. Editing clears the approval.</p>
            </div>
          </>
        ) : <MessageBody m={m} />}
      </div>
    </Dialog>
  );
}
