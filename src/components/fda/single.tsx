"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Mail, MessageCircle, Search, Settings2, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, Pagination, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { AREA_LABEL, CHANNEL_LABEL, fdaDate, FREQUENCY_LABEL, type Channel, type FdaConfig, type FdaDoctor, type FdaDrug, type MessageTemplate, type Method } from "@/lib/fda";
import { cn, DEPARTMENT_LABEL } from "@/lib/utils";
import { AreaBadge } from "./drugs";
import { CampaignReview, generateAll } from "./review";
import { VariableChips } from "./variables";

export function SingleMessage({ config }: { config?: FdaConfig }) {
  const [doctor, setDoctor] = React.useState<FdaDoctor | null>(null);
  const [drug, setDrug] = React.useState<FdaDrug | null>(null);
  const [channel, setChannel] = React.useState<Channel>("WHATSAPP");
  const [method, setMethod] = React.useState<Method>("TEMPLATE");
  const [templateId, setTemplateId] = React.useState("");
  const [objective, setObjective] = React.useState("");
  const [manualSubject, setManualSubject] = React.useState("");
  const [manualBody, setManualBody] = React.useState("");
  const [campaignId, setCampaignId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reset = () => { setCampaignId(null); setDrug(null); setDoctor(null); setManualBody(""); setManualSubject(""); };

  const generate = async () => {
    if (!doctor || !drug) return;
    setBusy(true);
    try {
      const res = await api.post<{ campaign: { id: string }; counts: { pending: number; skipped: number } }>("/campaigns", {
        name: `Single: ${doctor.doctor_name} · ${drug.drug_name}`.slice(0, 200), mode: "SINGLE", objective: objective || null,
        channel, message_method: method, drug_mode: "MANUAL", drug_id: drug.id, template_id: method === "TEMPLATE" ? templateId : null,
        doctor_ids: [doctor.id],
      });
      if (res.counts.pending) {
        await generateAll(res.campaign.id, () => undefined, method === "MANUAL" ? { subject: manualSubject, body: manualBody } : undefined);
      }
      setCampaignId(res.campaign.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : method === "AI" ? "AI generation failed." : "Could not create the message");
    } finally {
      setBusy(false);
    }
  };

  if (campaignId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCampaignId(null)}><ArrowLeft className="h-3.5 w-3.5" /> Back to the message setup</Button>
          <Button variant="ghost" size="sm" onClick={reset}>New single message</Button>
        </div>
        <SummaryStrip doctor={doctor} drug={drug} channel={channel} method={method} />
        <CampaignReview id={campaignId} single />
      </div>
    );
  }

  const canGenerate = doctor && drug && doctor.eligible && (method !== "TEMPLATE" || templateId) && (method !== "MANUAL" || manualBody.trim())
    && (method !== "AI" || config?.openrouter);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <Step n={1} title="Select doctor" done={!!doctor}>
          <DoctorPicker value={doctor} onChange={(d) => { setDoctor(d); setDrug(null); }} />
        </Step>
        <Step n={2} title="FDA drug" done={!!drug} disabled={!doctor}>
          {doctor && <DrugPicker doctor={doctor} value={drug} onChange={setDrug} />}
        </Step>
      </div>
      <div className="space-y-5">
        <Step n={3} title="Communication channel" done disabled={!drug}>
          <div className="grid grid-cols-3 gap-2">
            {(["WHATSAPP", "EMAIL", "BOTH"] as Channel[]).map((c) => (
              <Choice key={c} active={channel === c} onClick={() => { setChannel(c); setTemplateId(""); }}
                disabled={(c !== "EMAIL" && !doctor?.whatsapp_number && !doctor?.contact_number) || (c !== "WHATSAPP" && !doctor?.email)}>
                {c === "EMAIL" ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}{CHANNEL_LABEL[c]}
              </Choice>
            ))}
          </div>
        </Step>
        <Step n={4} title="Message method" done disabled={!drug}>
          <div className="grid grid-cols-3 gap-2">
            <Choice active={method === "TEMPLATE"} onClick={() => setMethod("TEMPLATE")}>Existing template</Choice>
            <Choice active={method === "AI"} onClick={() => setMethod("AI")} disabled={!config?.openrouter}><Sparkles className="h-4 w-4" />Generate with AI</Choice>
            <Choice active={method === "MANUAL"} onClick={() => setMethod("MANUAL")}>Write manually</Choice>
          </div>
          <div className="mt-3">
            {method === "TEMPLATE" && <TemplateSelect channel={channel} value={templateId} onChange={setTemplateId} />}
            {method === "AI" && (
              <div>
                <Label>Message objective (optional)</Label>
                <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={500}
                  placeholder="e.g. Share the FDA update and offer help with availability / named-patient access." />
                <p className="mt-1 text-[11px] text-ink-soft">The AI writes from the FDA record only; any figure not in the FDA data sends the draft to review.</p>
              </div>
            )}
            {method === "MANUAL" && (
              <div className="space-y-2">
                {channel !== "WHATSAPP" && <div><Label>Email subject</Label><Input value={manualSubject} onChange={(e) => setManualSubject(e.target.value)} placeholder="FDA Drug Information Update – {{drug_name}}" /></div>}
                <div>
                  <Label>Message</Label>
                  <Textarea id="manual-body" rows={9} value={manualBody} onChange={(e) => setManualBody(e.target.value)}
                    placeholder={"Dear {{doctor_name}},\n\nWe would like to share an update regarding {{drug_name}} ({{active_ingredient}})…"} />
                </div>
                <VariableChips config={config} targetId="manual-body" value={manualBody} onChange={setManualBody} />
              </div>
            )}
          </div>
        </Step>
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-soft">{!doctor ? "Select a doctor first." : !doctor.eligible ? `Doctor is not eligible until ${fdaDate(doctor.eligible_from)}.` : !drug ? "Choose an FDA drug." : "You will see a preview before anything is sent."}</p>
            <Button disabled={!canGenerate || busy} onClick={generate}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {method === "AI" ? "Generate with AI" : "Create preview"}
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function SummaryStrip({ doctor, drug, channel, method }: { doctor: FdaDoctor | null; drug: FdaDrug | null; channel: Channel; method: Method }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-white p-4 text-sm md:grid-cols-5">
      <div><p className="text-[11px] uppercase text-ink-soft">Doctor</p><p className="font-medium">{doctor?.doctor_name}</p></div>
      <div><p className="text-[11px] uppercase text-ink-soft">Drug</p><p className="font-medium">{drug?.drug_name}</p></div>
      <div><p className="text-[11px] uppercase text-ink-soft">FDA status</p><p className="font-medium">{drug?.fda_status ?? "—"}{drug?.approval_date ? ` · ${fdaDate(drug.approval_date)}` : ""}</p></div>
      <div><p className="text-[11px] uppercase text-ink-soft">Channel</p><p className="font-medium">{CHANNEL_LABEL[channel]}</p></div>
      <div><p className="text-[11px] uppercase text-ink-soft">Method</p><p className="font-medium">{method === "AI" ? "AI" : method === "TEMPLATE" ? "Template" : "Manual"}</p></div>
    </div>
  );
}

function Step({ n, title, done, disabled, children }: { n: number; title: string; done?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Card className={cn(disabled && "pointer-events-none opacity-50")}>
      <CardHeader title={<span className="inline-flex items-center gap-2"><span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", done && !disabled ? "bg-brand-800 text-white" : "bg-slate-100 text-ink-muted")}>{n}</span>{title}</span>} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export function Choice({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn("flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-200" : "border-line text-ink hover:bg-slate-50")}>
      {children}
    </button>
  );
}

function DoctorPicker({ value, onChange }: { value: FdaDoctor | null; onChange: (d: FdaDoctor | null) => void }) {
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [audience, setAudience] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [edit, setEdit] = React.useState<FdaDoctor | null>(null);
  React.useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, isLoading } = useQuery({
    queryKey: ["fda-doctors", dq, audience, page],
    queryFn: () => api.get<{ items: FdaDoctor[]; total: number }>("/fda/doctors", { q: dq, audience, page, page_size: 8 }),
  });

  if (value) {
    return (
      <div className="space-y-3">
        <DoctorCard d={value} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onChange(null)}>Change doctor</Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit(value)}><Settings2 className="h-3.5 w-3.5" /> Must See / frequency</Button>
        </div>
        {edit && <OutreachDialog d={edit} onClose={(upd) => { setEdit(null); if (upd) onChange({ ...value, ...upd }); }} />}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, hospital, specialty, department, city, state…" className="pl-8" />
        </div>
        <Select value={audience} onChange={(e) => { setAudience(e.target.value); setPage(1); }} className="w-auto" aria-label="Filter">
          <option value="all">All</option><option value="must_see">Must See</option><option value="regular">Regular</option><option value="new">New Doctors</option>
        </Select>
      </div>
      {isLoading ? <Skeleton className="h-40" /> : !data?.items.length ? <EmptyState title="No doctors found" /> : (
        <div className="divide-y divide-line rounded-md border border-line">
          {data.items.map((d) => (
            <button key={d.id} onClick={() => onChange(d)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{d.must_see && <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" />}{d.doctor_name}</p>
                <p className="truncate text-[11px] text-ink-soft">{[d.specialty, d.institute, d.city].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-ink-muted">{d.areas_label}</span>
                {!d.eligible && <Badge tone="amber">Not eligible until {fdaDate(d.eligible_from)}</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}
      {data && data.total > 8 && <Pagination page={page} pageSize={8} total={data.total} onPage={setPage} />}
    </div>
  );
}

export function DoctorCard({ d }: { d: FdaDoctor }) {
  const wa = d.whatsapp_number || d.contact_number;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-line bg-slate-50/50 p-3 text-sm">
      <div className="col-span-2 flex items-center gap-2">
        <span className="font-semibold text-ink">{d.doctor_name}</span>
        {d.must_see && <Badge tone="amber"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />MUST SEE</Badge>}
        {!d.eligible && <Badge tone="amber">Not eligible until {fdaDate(d.eligible_from)}</Badge>}
      </div>
      <Item label="Specialty" value={d.specialty || d.sub_department} />
      <Item label="Hospital" value={d.institute} />
      <Item label="Department" value={`${d.sub_department ?? DEPARTMENT_LABEL[d.department]} · ${d.areas_label}`} />
      <Item label="City / State" value={[d.city, d.state].filter(Boolean).join(", ")} />
      <Item label="WhatsApp" value={wa} />
      <Item label="Email" value={d.email} />
      <Item label="Frequency" value={d.contact_frequency ? (d.contact_frequency === "CUSTOM" ? `${d.frequency_days} days` : FREQUENCY_LABEL[d.contact_frequency]) : "Not set"} />
      <Item label="Must See" value={d.must_see ? "YES" : "No"} />
    </dl>
  );
}

function Item({ label, value }: { label: string; value?: string | null }) {
  return <div><dt className="text-[10px] font-medium uppercase tracking-wide text-ink-soft">{label}</dt><dd className="text-[13px] text-ink">{value || "—"}</dd></div>;
}

function OutreachDialog({ d, onClose }: { d: FdaDoctor; onClose: (upd?: Partial<FdaDoctor>) => void }) {
  const qc = useQueryClient();
  const [mustSee, setMustSee] = React.useState(d.must_see);
  const [freq, setFreq] = React.useState(d.contact_frequency ?? "");
  const [days, setDays] = React.useState(d.frequency_days ?? 20);
  const save = useMutation({
    mutationFn: () => api.put(`/fda/doctors/${d.id}/outreach`, { must_see: mustSee, contact_frequency: freq || null, frequency_days: freq === "CUSTOM" ? days : null }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["fda-doctors"] }); onClose({ must_see: mustSee, contact_frequency: freq || null, frequency_days: freq === "CUSTOM" ? days : null }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Must See & contact frequency" description={d.doctor_name}
      footer={<><Button variant="outline" onClick={() => onClose()}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={mustSee} onChange={(e) => setMustSee(e.target.checked)} /> ⭐ Must See doctor</label>
        <div>
          <Label>Contact frequency</Label>
          <Select value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="">No limit</option><option value="WEEKLY">Weekly</option><option value="15_DAYS">15 Days</option><option value="MONTHLY">Monthly</option><option value="CUSTOM">Custom</option>
          </Select>
        </div>
        {freq === "CUSTOM" && <div><Label>Days between messages</Label><Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>}
        <p className="text-xs text-ink-soft">After a message is sent, the doctor cannot be messaged again until the window has passed.</p>
      </div>
    </Dialog>
  );
}

function DrugPicker({ doctor, value, onChange }: { doctor: FdaDoctor; value: FdaDrug | null; onChange: (d: FdaDrug) => void }) {
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const rec = useQuery({
    queryKey: ["fda-recs", doctor.id, dq],
    queryFn: () => api.get<{ areas: string[]; areas_label: string; items: FdaDrug[]; note?: string }>(`/fda/doctors/${doctor.id}/recommendations`, { q: dq }),
  });
  const general = rec.data && rec.data.areas.length === 0;
  const manual = useQuery({
    queryKey: ["fda-drugs-manual", dq],
    queryFn: () => api.get<{ items: FdaDrug[] }>("/fda/drugs", { q: dq, sendable: true, page_size: 15 }),
    enabled: !!general && dq.length >= 2,
  });
  const items = general ? manual.data?.items ?? [] : rec.data?.items ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">
        {general ? rec.data?.note + " Search for a drug manually if appropriate."
          : <>Recommended FDA drugs for <b>{rec.data?.areas_label ?? "…"}</b>, based on the FDA label classification. Drugs that need review are never shown.</>}
      </p>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={general ? "Search FDA drugs (2+ letters)…" : "Filter recommendations…"} />
      {rec.isLoading ? <Skeleton className="h-32" /> : !items.length ? (
        <EmptyState title={general ? "Search to choose a drug" : "No reviewed FDA drugs for this specialty yet"} description={general ? undefined : "Run the FDA sync or review classifications in Drug Intelligence."} />
      ) : (
        <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {items.map((d) => (
            <button key={d.id} onClick={() => onChange(d)} className={cn("flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50", value?.id === d.id && "bg-brand-50/60")}>
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", value?.id === d.id ? "border-brand-700 bg-brand-700 text-white" : "border-line")}>
                {value?.id === d.id && <Check className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{d.drug_name} <span className="font-normal text-ink-soft">({d.active_ingredient || d.generic_name})</span></p>
                <p className="text-[11px] text-ink-soft">{d.fda_status} · approved {fdaDate(d.approval_date)} · {d.manufacturer}</p>
                {d.last_sent_to_doctor && <p className="text-[11px] text-amber-700">Already sent to this doctor on {fdaDate(d.last_sent_to_doctor)}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-1">{(d.matched_areas?.length ? d.matched_areas : d.therapeutic_areas).map((a) => <AreaBadge key={a} value={a} />)}</div>
            </button>
          ))}
        </div>
      )}
      {value && <p className="text-xs text-ink-muted">Selected: <b>{value.drug_name}</b> · {AREA_LABEL[value.department ?? ""] ?? ""}</p>}
    </div>
  );
}

export function TemplateSelect({ channel, value, onChange }: { channel: Channel; value: string; onChange: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["fda-templates", "ACTIVE"],
    queryFn: () => api.get<MessageTemplate[]>("/fda/templates", { status: "ACTIVE" }),
  });
  const usable = (data ?? []).filter((t) => t.channel === "BOTH" || t.channel === channel);
  if (isLoading) return <Skeleton className="h-9" />;
  if (!usable.length) return <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-ink-muted">No active {CHANNEL_LABEL[channel]} template yet. Create and activate one in the Templates tab.</p>;
  return (
    <div>
      <Label>Template</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a template…</option>
        {usable.map((t) => <option key={t.id} value={t.id}>{t.name} · {AREA_LABEL[t.department]} · {CHANNEL_LABEL[t.channel]} · v{t.version}</option>)}
      </Select>
    </div>
  );
}
