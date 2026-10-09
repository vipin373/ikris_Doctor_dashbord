"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, Loader2, Search, Sparkles, Star, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, StatCard, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { AREA_LABEL, CHANNEL_LABEL, fdaDate, type Channel, type FdaConfig, type FdaDrug, type Method } from "@/lib/fda";
import { cn, DEPARTMENT_LABEL, number } from "@/lib/utils";
import { AreaBadge } from "./drugs";
import { CampaignReview, generateAll } from "./review";
import { Choice, TemplateSelect } from "./single";

const FIELD_LABEL: Record<string, string> = {
  doctor_name: "Doctor Name", specialty: "Specialty", hospital: "Hospital", whatsapp_number: "WhatsApp Number", email: "Email",
  department: "Department", frequency: "Frequency", must_see: "Must See", city: "City", state: "State", country: "Country",
  active: "Active", notes: "Notes",
};

interface Parsed { filename: string; columns: string[]; rows: string[][]; mapping: Record<string, number | null>; fields: string[] }
interface VRow {
  row: number; doctor_name: string; specialty: string | null; institute: string | null; whatsapp_number: string | null; email: string | null;
  department: "NPP" | "RARE_DISEASES" | null; sub_department: string | null; city: string | null; state: string | null; country: string | null;
  contact_frequency: string | null; frequency_days: number | null; must_see: boolean | null; active: string | null; notes: string | null;
  dedupe_key: string; email_norm: string | null; phone_norm: string | null; name_norm: string | null;
  existing_doctor_id: string | null; match_by: string | null; is_new: boolean; duplicate: boolean; issues: string[]; blocking: boolean; areas: string[];
}
interface Validation { rows: VRow[]; summary: Record<string, number> }

export function BulkUpload({ config }: { config?: FdaConfig }) {
  const { me } = useAuth();
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, number | null>>({});
  const [defaultDept, setDefaultDept] = React.useState("");
  const [validation, setValidation] = React.useState<Validation | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [doctorIds, setDoctorIds] = React.useState<string[] | null>(null);
  const [campaignId, setCampaignId] = React.useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { toast.error("Upload a .xlsx, .xls or .csv file."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("The file is larger than 5 MB."); return; }
    setBusy("Reading file…");
    try {
      const p = await api.upload<Parsed>("/fda/bulk/parse", file);
      setParsed(p); setMapping(p.mapping); setValidation(null); setDoctorIds(null); setCampaignId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    } finally { setBusy(null); }
  };

  const validate = async () => {
    if (!parsed) return;
    setBusy("Validating doctors…");
    try {
      setValidation(await api.post<Validation>("/fda/bulk/validate", { rows: parsed.rows, mapping, default_department: defaultDept || null }));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Validation failed"); } finally { setBusy(null); }
  };

  if (campaignId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => { setCampaignId(null); setDoctorIds(null); setValidation(null); setParsed(null); }}><ArrowLeft className="h-3.5 w-3.5" /> New bulk upload</Button>
        <CampaignReview id={campaignId} />
      </div>
    );
  }
  if (doctorIds && validation) {
    return <BulkCampaignSetup config={config} doctorIds={doctorIds} filename={parsed?.filename ?? "upload"} onBack={() => setDoctorIds(null)} onCreated={setCampaignId} />;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Upload doctor file" description="Excel (.xlsx, .xls) or CSV, up to 5 MB / 5,000 rows. Expected columns: Doctor Name, Specialty, Hospital, WhatsApp Number, Email, Department, Frequency, Must See, City, State, Country, Active, Notes." />
        <CardBody>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line px-6 py-8 text-center hover:border-brand-300 hover:bg-brand-50/30">
            {busy === "Reading file…" ? <Loader2 className="h-6 w-6 animate-spin text-brand-700" /> : <FileSpreadsheet className="h-6 w-6 text-brand-700" />}
            <span className="text-sm font-medium text-ink">{parsed ? `${parsed.filename} · ${number(parsed.rows.length)} rows` : "Choose a file"}</span>
            <span className="text-xs text-ink-soft">Columns are mapped automatically; you can adjust them below.</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </CardBody>
      </Card>

      {parsed && (
        <Card>
          <CardHeader title="2. Column mapping" action={<Button size="sm" disabled={!!busy || mapping.doctor_name == null} onClick={validate}>{busy === "Validating doctors…" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Validate doctors</Button>} />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {parsed.fields.map((f) => (
                <div key={f}>
                  <Label>{FIELD_LABEL[f] ?? f}{f === "doctor_name" && " *"}</Label>
                  <Select value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">— not in file —</option>
                    {parsed.columns.map((c, i) => <option key={i} value={i}>{c || `Column ${i + 1}`}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {me?.role === "ADMIN" && (
              <div className="max-w-xs">
                <Label>Department when the file does not say</Label>
                <Select value={defaultDept} onChange={(e) => setDefaultDept(e.target.value)}>
                  <option value="">Work it out from specialty</option><option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option>
                </Select>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {validation && <ValidationView v={validation} onContinue={setDoctorIds} />}
    </div>
  );
}

function ValidationView({ v, onContinue }: { v: Validation; onContinue: (ids: string[]) => void }) {
  const s = v.summary;
  const [filter, setFilter] = React.useState("all");
  const [applyOutreach, setApplyOutreach] = React.useState(true);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const usable = v.rows.filter((r) => !r.blocking);
  const newRows = usable.filter((r) => r.is_new);
  const existing = usable.filter((r) => !r.is_new);
  const rows = v.rows.filter((r) => filter === "all" || (filter === "new" && r.is_new && !r.duplicate) || (filter === "existing" && !r.is_new)
    || (filter === "issues" && r.issues.length > 0) || (filter === "must" && r.must_see));

  const go = async () => {
    setBusy(true);
    try {
      const payload = [
        ...newRows.map((r) => ({
          department: r.department, dedupe_key: r.dedupe_key, doctor_name: r.doctor_name, sub_department: r.sub_department, specialty: r.specialty,
          institute: r.institute, city: r.city, state: r.state, country: r.country, whatsapp_number: r.whatsapp_number, email: r.email,
          email_norm: r.email_norm, phone_norm: r.phone_norm, name_norm: r.name_norm, must_see: r.must_see ?? undefined,
          contact_frequency: r.contact_frequency ?? undefined, frequency_days: r.frequency_days ?? undefined, notes: r.notes, active: r.active,
        })),
        ...existing.filter((r) => applyOutreach && (r.must_see !== null || r.contact_frequency)).map((r) => ({
          doctor_id: r.existing_doctor_id, must_see: r.must_see ?? undefined, contact_frequency: r.contact_frequency ?? undefined,
          frequency_days: r.frequency_days ?? undefined,
        })),
      ];
      let ids: string[] = existing.map((r) => r.existing_doctor_id!).filter(Boolean);
      if (payload.length) {
        const res = await api.post<{ items: { doctor_id: string; created: boolean }[]; created: number; matched: number }>("/doctors/import", { rows: payload });
        ids = Array.from(new Set([...ids, ...res.items.map((x) => x.doctor_id)]));
        toast.success(`${res.created} new doctor${res.created === 1 ? "" : "s"} added${applyOutreach && existing.length ? "; Must See / frequency updated for matched doctors" : ""}.`);
      }
      setConfirm(false);
      onContinue(ids);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="3. Validation" description="Doctors are matched by WhatsApp number, then email, then name + hospital. Nothing is added until you confirm."
        action={<Button size="sm" disabled={!usable.length} onClick={() => setConfirm(true)}>Continue with {usable.length} doctors</Button>} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Total doctors" value={number(s.total)} />
          <StatCard label="Existing doctors" value={number(s.existing)} tone="green" />
          <StatCard label="New doctors" value={number(s.new)} tone="sky" />
          <StatCard label="Must See" value={number(s.must_see)} tone="amber" />
          <StatCard label="Duplicates" value={number(s.duplicates)} tone={s.duplicates ? "red" : "brand"} />
          <StatCard label="Oncology" value={number(s.oncology)} tone="sky" />
          <StatCard label="Hematology" value={number(s.hematology)} tone="red" />
          <StatCard label="Rare Disease" value={number(s.rare_disease)} tone="violet" />
          <StatCard label="Invalid WhatsApp" value={number(s.invalid_whatsapp)} tone={s.invalid_whatsapp ? "amber" : "brand"} />
          <StatCard label="Missing email" value={number(s.missing_email)} tone={s.missing_email ? "amber" : "brand"} />
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {[["all", "All"], ["new", "New"], ["existing", "Existing"], ["must", "Must See"], ["issues", "With issues"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full border px-2.5 py-1", filter === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line text-ink-muted")}>{l}</button>
          ))}
        </div>
        <div className="max-h-[420px] overflow-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead><tr><Th>Row</Th><Th>Doctor</Th><Th>Department</Th><Th>Contact</Th><Th>Status</Th><Th>Issues</Th></tr></thead>
            <tbody>
              {rows.slice(0, 500).map((r) => (
                <tr key={r.row} className={cn(r.blocking && "bg-red-50/40")}>
                  <Td className="text-xs text-ink-soft">{r.row}</Td>
                  <Td>
                    <p className="font-medium text-ink">{r.must_see && <Star className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-400" />}{r.doctor_name}</p>
                    <p className="text-[11px] text-ink-soft">{[r.specialty, r.institute, r.city].filter(Boolean).join(" · ")}</p>
                  </Td>
                  <Td className="text-xs">{r.department ? `${r.sub_department ?? DEPARTMENT_LABEL[r.department]}` : "—"}<div className="mt-0.5 flex gap-1">{r.areas.map((a) => <AreaBadge key={a} value={a} />)}</div></Td>
                  <Td className="text-xs">{r.whatsapp_number ?? "—"}<br /><span className="text-ink-soft">{r.email ?? "—"}</span></Td>
                  <Td>{r.duplicate ? <Badge tone="red">Duplicate</Badge> : r.is_new ? <Badge tone="sky">New Doctor</Badge> : <Badge tone="green" title={`Matched by ${r.match_by}`}>Existing</Badge>}</Td>
                  <Td className="max-w-[260px] text-[11px] text-ink-muted">{r.issues.join("; ") || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
      <Dialog open={confirm} onOpenChange={setConfirm} title="Confirm doctors"
        footer={<><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={busy} onClick={go}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm</Button></>}>
        <div className="space-y-2 text-sm">
          <p><b>{newRows.length}</b> new doctor{newRows.length === 1 ? "" : "s"} will be added to the doctor database.</p>
          <p><b>{existing.length}</b> existing doctor{existing.length === 1 ? "" : "s"} matched.</p>
          {existing.some((r) => r.must_see !== null || r.contact_frequency) && (
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={applyOutreach} onChange={(e) => setApplyOutreach(e.target.checked)} />Apply Must See / Frequency from the file to existing doctors</label>
          )}
          {v.rows.length - usable.length > 0 && <p className="text-xs text-amber-800">{v.rows.length - usable.length} row(s) with blocking issues (duplicate, no department access, or no contact) are left out.</p>}
        </div>
      </Dialog>
    </Card>
  );
}

function BulkCampaignSetup({ config, doctorIds, filename, onBack, onCreated }: {
  config?: FdaConfig; doctorIds: string[]; filename: string; onBack: () => void; onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState(`Bulk: ${filename}`.slice(0, 200));
  const [drugMode, setDrugMode] = React.useState<"AUTO" | "MANUAL">("AUTO");
  const [drug, setDrug] = React.useState<FdaDrug | null>(null);
  const [q, setQ] = React.useState("");
  const [channel, setChannel] = React.useState<Channel>("WHATSAPP");
  const [method, setMethod] = React.useState<Exclude<Method, "MANUAL">>("TEMPLATE");
  const [templateId, setTemplateId] = React.useState("");
  const [objective, setObjective] = React.useState("");
  const [progress, setProgress] = React.useState<{ made: number; pending: number } | null>(null);
  const drugs = useQuery({
    queryKey: ["fda-drugs-bulk", q],
    queryFn: () => api.get<{ items: FdaDrug[] }>("/fda/drugs", { q, sendable: true, page_size: 12 }),
    enabled: drugMode === "MANUAL",
  });

  const start = async () => {
    try {
      setProgress({ made: 0, pending: doctorIds.length });
      const res = await api.post<{ campaign: { id: string }; counts: { doctors: number; pending: number; skipped: number } }>("/campaigns", {
        name, mode: "BULK", objective: objective || null, channel, message_method: method, drug_mode: drugMode,
        drug_id: drugMode === "MANUAL" ? drug?.id : null, template_id: method === "TEMPLATE" ? templateId : null, doctor_ids: doctorIds,
      });
      toast.info(`${res.counts.pending} doctors matched to an FDA drug; ${res.counts.skipped} skipped (reasons shown in review).`);
      await generateAll(res.campaign.id, (made, pending) => setProgress({ made, pending }));
      onCreated(res.campaign.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate messages");
      setProgress(null);
    }
  };

  const ready = name.trim() && (drugMode === "AUTO" || drug) && (method === "AI" ? config?.openrouter : templateId);
  return (
    <div className="space-y-5">
      <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> Back to validation</Button>
      <Card>
        <CardHeader title={`4. Campaign for ${number(doctorIds.length)} doctors`} description="Each doctor is matched to FDA drugs for their own specialty. Unrelated drugs are never used." />
        <CardBody className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div><Label>Campaign name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></div>
            <div>
              <Label>Drug selection</Label>
              <div className="grid grid-cols-2 gap-2">
                <Choice active={drugMode === "AUTO"} onClick={() => setDrugMode("AUTO")}><Sparkles className="h-4 w-4" />Automatically match FDA drugs</Choice>
                <Choice active={drugMode === "MANUAL"} onClick={() => setDrugMode("MANUAL")}><Search className="h-4 w-4" />Select FDA drug manually</Choice>
              </div>
              {drugMode === "AUTO" ? (
                <p className="mt-2 text-xs text-ink-soft">Oncology doctors get oncology drugs, hematology doctors hematology drugs, rare-disease doctors rare-disease drugs, preferring drugs each doctor has not received yet. Doctors without a matching specialty are skipped.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search FDA drugs…" />
                  <div className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line">
                    {(drugs.data?.items ?? []).map((d) => (
                      <button key={d.id} onClick={() => setDrug(d)} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50", drug?.id === d.id && "bg-brand-50")}>
                        <span><b>{d.drug_name}</b> <span className="text-ink-soft">({d.active_ingredient}) · {fdaDate(d.approval_date)}</span></span>
                        <span className="flex gap-1">{d.therapeutic_areas.map((a) => <AreaBadge key={a} value={a} />)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink-soft">Doctors whose specialty does not match the drug&apos;s area are skipped.</p>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <Label>Channel</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["WHATSAPP", "EMAIL", "BOTH"] as Channel[]).map((c) => <Choice key={c} active={channel === c} onClick={() => { setChannel(c); setTemplateId(""); }}>{CHANNEL_LABEL[c]}</Choice>)}
              </div>
            </div>
            <div>
              <Label>Message method</Label>
              <div className="grid grid-cols-2 gap-2">
                <Choice active={method === "TEMPLATE"} onClick={() => setMethod("TEMPLATE")}>Existing template</Choice>
                <Choice active={method === "AI"} onClick={() => setMethod("AI")} disabled={!config?.openrouter}><Sparkles className="h-4 w-4" />AI generated (one per doctor)</Choice>
              </div>
              <div className="mt-2">
                {method === "TEMPLATE" ? <TemplateSelect channel={channel} value={templateId} onChange={setTemplateId} /> : (
                  <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Message objective (optional)" maxLength={500} />
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-xs text-ink-soft">{progress ? `Generated ${progress.made} message(s); ${progress.pending} doctor(s) left…` : "Messages are generated for review. Nothing is sent yet."}</p>
              <Button disabled={!ready || !!progress} onClick={start}>{progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Generate messages</Button>
            </div>
          </div>
        </CardBody>
      </Card>
      <span className="hidden">{AREA_LABEL.ONCOLOGY}</span>
    </div>
  );
}
