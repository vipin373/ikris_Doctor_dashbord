"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Mail, MessageCircle, Plus, Send, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  CATEGORY_META, CategoryBadge, CrmFilterFields, takeOutreachSelection, toApiFilters, useGroups, type CrmFilters,
} from "@/components/npp/shared";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, PageHeader, Skeleton, Switch, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, formatDateTime, number } from "@/lib/utils";

type Channel = "EMAIL" | "WHATSAPP";
type AudienceType = "category" | "group" | "selected" | "filters";
interface Campaign { id: string; name: string; channel: Channel; sequence: string | null; subject: string | null; status: string; recipients: number; sent_count: number; failed_count: number; skipped_count: number; created_at: string; sent_at: string | null }
interface Preview { matched: number; sendable: number; skipped: Record<string, number>; by_category: Record<string, number>; recipients: { id: string; doctor_name: string; category: string | null; to: string; institute: string | null; city: string | null }[]; config_problem: string | null }
interface WaTemplate { id: string; name: string; whatsapp_template_name: string | null; whatsapp_approval_status: string; whatsapp_variables: string[] | null; body: string; usable: boolean; reason: string | null }

const SEQUENCES = ["1st Email", "2nd Email", "3rd Email", "Follow-up Email", "Final Follow-up"] as const;
const VARS = ["doctor_name", "specialty", "hospital", "city", "state"];

export default function OutreachPage() {
  const { me } = useAuth();
  const params = useSearchParams();
  const [composing, setComposing] = React.useState(false);
  const [openCampaign, setOpenCampaign] = React.useState<string | null>(null);
  const preselect = React.useMemo(() => ({ group: params.get("group"), channel: params.get("channel") as Channel | null }), [params]);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    const ids = takeOutreachSelection();
    if (ids.length) { setSelectedIds(ids); setComposing(true); }
    if (preselect.group) setComposing(true);
  }, [preselect.group]);
  const { data: campaigns, isLoading } = useQuery({ queryKey: ["npp-outreach"], queryFn: () => api.get<Campaign[]>("/npp/outreach") });

  if (me && !me.departments.includes("NPP")) return <Card><EmptyState title="No access" description="Outreach is for NPP." /></Card>;
  return (
    <div>
      <PageHeader breadcrumb={<Link href="/npp" className="hover:underline">NPP</Link>} title="Email & WhatsApp Campaigns"
        description="Send to a category, a group or selected doctors. Nothing is sent without your confirmation; each message records the doctor's category at the time of sending."
        actions={!composing && <Button onClick={() => setComposing(true)}><Plus className="h-4 w-4" /> New campaign</Button>} />

      {composing && <Composer initialChannel={preselect.channel ?? "EMAIL"} initialGroup={preselect.group} selectedIds={selectedIds}
        onClose={() => { setComposing(false); setSelectedIds([]); }} onSent={(id) => { setComposing(false); setOpenCampaign(id); }} />}

      <Card className="mt-5">
        <CardHeader title="Campaigns" description="Newest first. Open one to see every recipient and any errors." />
        {isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !campaigns?.length ? (
          <EmptyState icon={Send} title="No campaigns yet" description="Create one to email or WhatsApp a category or group." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Campaign</Th><Th>Channel</Th><Th>Status</Th><Th>Recipients</Th><Th>Sent</Th><Th>Failed</Th><Th>Skipped</Th><Th>Created</Th></tr></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-cream/40" onClick={() => setOpenCampaign(c.id)}>
                    <Td><p className="font-medium">{c.name}</p><p className="text-[11px] text-ink-soft">{c.sequence}{c.subject ? ` · ${c.subject}` : ""}</p></Td>
                    <Td>{c.channel === "EMAIL" ? "Email" : "WhatsApp"}</Td>
                    <Td><Badge tone={statusTone(c.status === "PARTIAL" ? "warning" : c.status)}>{c.status}</Badge></Td>
                    <Td className="tabular-nums">{number(c.recipients)}</Td>
                    <Td className="tabular-nums text-sage-700">{number(c.sent_count)}</Td>
                    <Td className="tabular-nums text-red-600">{number(c.failed_count)}</Td>
                    <Td className="tabular-nums text-ink-soft">{number(c.skipped_count)}</Td>
                    <Td className="text-xs">{formatDateTime(c.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CampaignDialog id={openCampaign} onClose={() => setOpenCampaign(null)} />
    </div>
  );
}

function Composer({ initialChannel, initialGroup, selectedIds, onClose, onSent }: {
  initialChannel: Channel; initialGroup: string | null; selectedIds: string[]; onClose: () => void; onSent: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { data: groups } = useGroups();
  const { data: templates } = useQuery({ queryKey: ["npp-wa-templates"], queryFn: () => api.get<WaTemplate[]>("/npp/outreach-templates") });
  const [channel, setChannel] = React.useState<Channel>(initialChannel);
  const [type, setType] = React.useState<AudienceType>(selectedIds.length ? "selected" : initialGroup ? "group" : "category");
  const [cats, setCats] = React.useState<("A" | "B" | "C")[]>(["A"]);
  const [groupIds, setGroupIds] = React.useState<string[]>(initialGroup ? [initialGroup] : []);
  const [filters, setFilters] = React.useState<CrmFilters>({});
  const [includeUnassigned, setIncludeUnassigned] = React.useState(false);
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [name, setName] = React.useState("");
  const [sequence, setSequence] = React.useState<string>("1st Email");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("Dear {{doctor_name}},\n\n\n\nWarm regards,\nIkris Pharma Network");
  const [templateId, setTemplateId] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<{ id: string; sent: number; failed: number; remaining: number; skipped: number; done: boolean } | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  const audience = React.useMemo(() => ({
    type, categories: type === "category" ? cats : [], group_ids: type === "group" ? groupIds : [],
    doctor_ids: type === "selected" ? selectedIds : [], filters: type === "filters" ? toApiFilters(filters) : undefined,
    include_unassigned: type === "filters" ? includeUnassigned : false,
  }), [type, cats, groupIds, selectedIds, filters, includeUnassigned]);
  const audienceReady = (type === "category" && cats.length > 0) || (type === "group" && groupIds.length > 0) || (type === "selected" && selectedIds.length > 0) || type === "filters";
  const preview = useQuery({
    queryKey: ["npp-outreach-preview", channel, audience],
    queryFn: () => api.post<Preview>("/npp/outreach/preview", { channel, audience }),
    enabled: audienceReady,
  });
  React.useEffect(() => setExcluded(new Set()), [channel, audience]);
  const template = templates?.find((t) => t.id === templateId);
  const sendable = (preview.data?.sendable ?? 0) - excluded.size;
  const contentReady = channel === "EMAIL" ? subject.trim() && body.trim() : templateId ? !!template?.usable : body.trim();
  const sample = preview.data?.recipients.find((r) => !excluded.has(r.id));
  const render = (t: string) => t.replace(/\{\{\s*(doctor_name|specialty|hospital|city|state)\s*\}\}/g, (_, k: string) =>
    k === "doctor_name" ? sample?.doctor_name ?? "Dr Name" : k === "hospital" ? sample?.institute ?? "Hospital" : k === "city" ? sample?.city ?? "City" : `[${k}]`);

  const insertVar = (v: string) => {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setBody((b) => b + token);
    const s = el.selectionStart, e = el.selectionEnd;
    setBody((b) => b.slice(0, s) + token + b.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  const send = useMutation({
    mutationFn: async () => {
      const camp = await api.post<{ id: string; queued: number; skipped_count: number }>("/npp/outreach", {
        name: name.trim() || `${channel === "EMAIL" ? sequence : "WhatsApp"} · ${new Date().toLocaleDateString("en-IN")}`,
        channel, sequence: channel === "EMAIL" ? sequence : "WhatsApp", subject: channel === "EMAIL" ? subject : null,
        body: channel === "EMAIL" || !templateId ? body : "", whatsapp_template_id: channel === "WHATSAPP" && templateId ? templateId : null,
        audience, exclude_doctor_ids: [...excluded], confirm: true,
      });
      setConfirmOpen(false);
      let state = { id: camp.id, sent: 0, failed: 0, remaining: camp.queued, skipped: camp.skipped_count, done: false };
      setProgress(state);
      // send in batches; every result is confirmed by the provider before it counts as sent
      for (let i = 0; i < 400 && state.remaining > 0; i++) {
        const r = await api.post<{ remaining: number; sent: number; failed: number; skipped: number; status: string }>(`/npp/outreach/${camp.id}/send`);
        state = { ...state, sent: r.sent, failed: r.failed, remaining: r.remaining, skipped: r.skipped };
        setProgress({ ...state });
      }
      state = { ...state, done: true };
      setProgress(state);
      return state;
    },
    onSuccess: (s) => {
      if (s.failed && !s.sent) toast.error(`No messages were sent: ${number(s.failed)} failed. Open the campaign to see why.`);
      else toast.success(`${number(s.sent)} sent` + (s.failed ? ` · ${number(s.failed)} failed` : ""));
      ["npp-outreach", "npp-category-summary", "npp-analytics", "doctors", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => { setConfirmOpen(false); toast.error(e.message); qc.invalidateQueries({ queryKey: ["npp-outreach"] }); },
  });

  return (
    <Card className="animate-rise">
      <CardHeader title="New campaign" description="1 Audience → 2 Recipients → 3 Message → Confirm & send"
        action={!send.isPending && <button onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-cream" aria-label="Close"><X className="h-4 w-4" /></button>} />
      <CardBody className="grid gap-6 lg:grid-cols-2">
        {/* 1. audience */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-walnut-600">1 · Audience</h3>
          <div className="grid grid-cols-2 gap-2">
            {(["EMAIL", "WHATSAPP"] as const).map((c) => (
              <button key={c} onClick={() => setChannel(c)} className={cn("flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all",
                channel === c ? "border-glow-400 bg-glow-50 text-glow-800 shadow-glow" : "border-line bg-white text-ink-muted hover:border-sage-300")}>
                {c === "EMAIL" ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />} {c === "EMAIL" ? "Email" : "WhatsApp"}
              </button>
            ))}
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value as AudienceType)} aria-label="Audience type">
            <option value="category">Doctor category</option>
            <option value="group">Doctor group(s)</option>
            {selectedIds.length > 0 && <option value="selected">Selected doctors ({number(selectedIds.length)})</option>}
            <option value="filters">Custom filters</option>
          </Select>
          {type === "category" && (
            <div>
              <div className="flex gap-2">
                {(["A", "B", "C"] as const).map((c) => (
                  <label key={c} className={cn("flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ring-inset",
                    cats.includes(c) ? cn("ring-1", CATEGORY_META[c].badge) : "border-line bg-white text-ink-muted")}>
                    <input type="checkbox" checked={cats.includes(c)} onChange={() => setCats((x) => x.includes(c) ? x.filter((y) => y !== c) : [...x, c])} />
                    Category {c}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-soft">Unassigned doctors are never included in category campaigns. To reach them, use Custom filters.</p>
            </div>
          )}
          {type === "group" && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
              {!groups?.length ? <p className="p-2 text-xs text-ink-soft">No groups yet. <Link href="/npp/groups" className="underline">Create one</Link>.</p> :
                groups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-cream/50">
                    <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => setGroupIds((x) => x.includes(g.id) ? x.filter((y) => y !== g.id) : [...x, g.id])} />
                    <span className="flex-1">{g.name}</span><span className="text-xs tabular-nums text-ink-soft">{number(g.members)}</span>
                  </label>
                ))}
            </div>
          )}
          {type === "filters" && (
            <div className="space-y-2">
              <CrmFilterFields value={filters} onChange={setFilters} />
              <label className="flex items-center gap-2 text-xs"><Switch checked={includeUnassigned} onChange={setIncludeUnassigned} /> Include Unassigned doctors (explicit custom selection)</label>
            </div>
          )}
        </section>

        {/* 2. recipients */}
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-walnut-600">2 · Recipients</h3>
          {!audienceReady ? <p className="text-sm text-ink-soft">Choose an audience.</p> : preview.isLoading ? <Skeleton className="h-40" /> : preview.error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{(preview.error as Error).message}</p>
          ) : preview.data && (
            <>
              {preview.data.config_problem && (
                <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {preview.data.config_problem}. Sending is blocked until it is set up.
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 text-center">
                <Mini label="In audience" v={preview.data.matched} />
                <Mini label="Will receive" v={Math.max(0, sendable)} tone="text-sage-700" />
                <Mini label="Skipped" v={preview.data.matched - preview.data.sendable + excluded.size} tone="text-ink-soft" />
              </div>
              {Object.entries(preview.data.skipped).map(([why, n]) => <p key={why} className="text-[11px] text-ink-soft">• {number(n)} skipped: {why}</p>)}
              <div className="flex flex-wrap gap-1">
                {(["A", "B", "C", "UNASSIGNED"] as const).map((k) => preview.data!.by_category[k] > 0 && (
                  <span key={k} className={cn("rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset", CATEGORY_META[k].badge)}>{CATEGORY_META[k].label}: {preview.data!.by_category[k]}</span>
                ))}
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
                {preview.data.recipients.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2 border-b border-line/60 px-2.5 py-1.5 text-xs last:border-0 hover:bg-cream/40">
                    <input type="checkbox" checked={!excluded.has(r.id)} onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                    <span className="flex-1 truncate"><b>{r.doctor_name}</b> <span className="text-ink-soft">· {r.to}</span></span>
                    <CategoryBadge category={r.category} />
                  </label>
                ))}
                {preview.data.sendable > preview.data.recipients.length && <p className="px-2.5 py-1.5 text-[11px] text-ink-soft">+ {number(preview.data.sendable - preview.data.recipients.length)} more</p>}
              </div>
            </>
          )}
        </section>

        {/* 3. message */}
        <section className="space-y-3 lg:col-span-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-walnut-600">3 · Message</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <div><Label>Campaign name</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oncology access – Nov" maxLength={160} /></div>
            {channel === "EMAIL" ? (
              <>
                <div><Label>Email sequence</Label>
                  <Select className="mt-1" value={sequence} onChange={(e) => setSequence(e.target.value)}>{SEQUENCES.map((s) => <option key={s}>{s}</option>)}</Select></div>
                <div><Label>Subject</Label><Input className="mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={250} /></div>
              </>
            ) : (
              <div className="md:col-span-2"><Label>WhatsApp message type</Label>
                <Select className="mt-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Free text (only reaches doctors who messaged you in the last 24 hours)</option>
                  {(templates ?? []).map((t) => <option key={t.id} value={t.id} disabled={!t.usable}>Template: {t.name}{t.usable ? "" : ` — ${t.reason}`}</option>)}
                </Select></div>
            )}
          </div>
          {channel === "WHATSAPP" && templateId && template ? (
            <div className="rounded-xl border border-line bg-cream/40 p-3 text-sm">
              <p className="text-xs text-ink-soft">Approved template “{template.whatsapp_template_name}” — fields filled from each doctor&apos;s record</p>
              <p className="mt-1 whitespace-pre-line">{render(template.body.replace(/\{\{\s*(\w+)\s*\}\}/g, "{{$1}}"))}</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Label className="mr-1">Body</Label>
                  {VARS.map((v) => <button key={v} type="button" onClick={() => insertVar(v)} className="rounded-md bg-sage-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-sage-800 ring-1 ring-inset ring-sage-200 hover:bg-sage-100">{`{{${v}}}`}</button>)}
                </div>
                <Textarea ref={bodyRef} rows={10} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
              </div>
              <div>
                <Label>Preview{sample ? ` for ${sample.doctor_name}` : ""}</Label>
                <div className="mt-1 h-[calc(100%-1.5rem)] min-h-[200px] whitespace-pre-line rounded-xl border border-line bg-white p-3 text-sm shadow-[inset_0_1px_2px_rgba(41,37,31,0.04)]">
                  {channel === "EMAIL" && <p className="mb-2 border-b border-line pb-2 text-xs"><b>Subject:</b> {render(subject) || <span className="text-ink-soft">—</span>}</p>}
                  {render(body)}
                </div>
              </div>
            </div>
          )}
          <p className="text-[11px] text-ink-soft">
            Attachments, scheduled sending and WhatsApp voice notes are not available yet. They need provider support that isn&apos;t set up, so the dashboard doesn&apos;t offer them.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={send.isPending}>Cancel</Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!preview.data || sendable <= 0 || !contentReady || !!preview.data?.config_problem || send.isPending}>
              <Send className="h-4 w-4" /> Review & send to {number(Math.max(0, sendable))}
            </Button>
          </div>
        </section>
      </CardBody>

      <Dialog open={confirmOpen} onOpenChange={(v) => !send.isPending && setConfirmOpen(v)} title={`Send ${channel === "EMAIL" ? "email" : "WhatsApp"} to ${number(sendable)} doctors?`}
        description="This sends real messages now. It can't be undone once a message has gone out."
        footer={<><Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={send.isPending}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending}>{send.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm & send</Button></>}>
        <ul className="space-y-1 text-sm">
          <li><b>Audience:</b> {type === "category" ? cats.map((c) => `Category ${c}`).join(", ") : type === "group" ? `${groupIds.length} group(s)` : type === "selected" ? "Selected doctors" : "Custom filters"}</li>
          <li><b>Recipients:</b> {number(sendable)} ({number((preview.data?.matched ?? 0) - sendable)} skipped)</li>
          {channel === "EMAIL" && <li><b>Subject:</b> {subject}</li>}
          {channel === "WHATSAPP" && <li><b>Type:</b> {templateId ? `Template ${template?.whatsapp_template_name}` : "Free text (24-hour window only)"}</li>}
        </ul>
      </Dialog>

      {progress && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{progress.done ? "Finished" : "Sending…"}</span>
            <span className="tabular-nums text-ink-soft">{number(progress.sent)} sent · {number(progress.failed)} failed · {number(progress.remaining)} left</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream">
            <div className="h-full rounded-full bg-gradient-to-r from-sage-600 to-glow-400 transition-[width] duration-500"
              style={{ width: `${Math.round(100 * (progress.sent + progress.failed) / Math.max(1, progress.sent + progress.failed + progress.remaining))}%` }} />
          </div>
          {progress.done && <Button className="mt-3" variant="outline" size="sm" onClick={() => onSent(progress.id)}><CheckCircle2 className="h-3.5 w-3.5" /> Open campaign report</Button>}
        </div>
      )}
    </Card>
  );
}

function Mini({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return <div className="rounded-xl border border-line bg-white px-2 py-2"><p className="text-[10.5px] text-ink-soft">{label}</p><p className={cn("text-lg font-bold tabular-nums", tone)}>{number(v)}</p></div>;
}

function CampaignDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["npp-outreach-messages", id],
    queryFn: () => api.get<{ id: number; doctor_id: string; category_at_send: string | null; recipient: string | null; status: string; error: string | null; sent_at: string | null; doctors: { doctor_name: string; institute: string | null } | null }[]>(`/npp/outreach/${id}/messages`),
    enabled: !!id,
  });
  const resume = useMutation({
    mutationFn: async () => { let r = { remaining: 1 }; for (let i = 0; i < 400 && r.remaining > 0; i++) r = await api.post(`/npp/outreach/${id}/send`); },
    onSuccess: () => { toast.success("Campaign finished"); qc.invalidateQueries({ queryKey: ["npp-outreach"] }); qc.invalidateQueries({ queryKey: ["npp-outreach-messages"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/npp/outreach/${id}/cancel`),
    onSuccess: () => { toast.success("Remaining messages cancelled"); qc.invalidateQueries({ queryKey: ["npp-outreach"] }); qc.invalidateQueries({ queryKey: ["npp-outreach-messages"] }); },
  });
  const queued = (data ?? []).filter((m) => m.status === "QUEUED").length;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} wide title="Campaign recipients" description="Category shown is the doctor's category when the campaign was sent.">
      {queued > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-glow-50 px-3 py-2 text-sm">
          <span>{number(queued)} messages still queued.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}>{resume.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Continue sending</Button>
            <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel rest</Button>
          </div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-xs">
            <thead><tr><Th>Doctor</Th><Th>Category at send</Th><Th>To</Th><Th>Status</Th><Th>Sent</Th></tr></thead>
            <tbody>
              {(data ?? []).map((m) => (
                <tr key={m.id}>
                  <Td><Link href={`/doctors/${m.doctor_id}`} className="font-medium hover:underline">{m.doctors?.doctor_name}</Link></Td>
                  <Td><CategoryBadge category={m.category_at_send} /></Td>
                  <Td>{m.recipient ?? "—"}</Td>
                  <Td><Badge tone={statusTone(m.status)}>{m.status}</Badge>{m.error && <p className="mt-0.5 max-w-[240px] text-red-600">{m.error}</p>}</Td>
                  <Td>{m.sent_at ? formatDateTime(m.sent_at) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
