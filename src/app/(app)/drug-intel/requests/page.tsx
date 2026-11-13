"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Plus, ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Td, Th } from "@/components/ui/misc";
import { CountryMatrix, DrugPicker, useMeta, type MatrixCell } from "@/components/drug-intel/shared";
import { api } from "@/lib/api";
import type { DoctorRow, Paged } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDate, formatDateTime } from "@/lib/utils";

interface Req {
  id: string; patient_reference_id: string | null; doctor_id: string | null; drug_id: string | null; requested_drug_name: string;
  generic_name: string | null; brand_name: string | null; strength: string | null; dosage_form: string | null; required_country: string | null;
  treating_doctor: string | null; request_date: string; request_status: string; regulatory_check_status: string; approval_check: string;
  marketing_check: string; stock_check: string; import_check: string; patient_permission_check: string; assigned_department: string;
  remarks: string | null; created_by: string | null; created_at: string;
  drug: { id: string; generic_name: string; brand_names: string[] } | null;
  doctor: { id: string; doctor_name: string; specialty: string | null; institute: string | null } | null;
}

const CHECKS: [keyof Req, string, string][] = [
  ["approval_check", "Regulatory approval", "Is the medicine approved in the source country? (from the official register)"],
  ["marketing_check", "Commercial marketing", "Is it actually marketed / launched there? Approval alone does not show this."],
  ["stock_check", "Physical stock", "Has a supplier confirmed stock is available?"],
  ["import_check", "Import eligibility (India)", "Can it legally be imported? Decided by the regulatory/compliance team only."],
  ["patient_permission_check", "Patient-specific import permission", "Has the patient-specific permission been granted?"],
];
const STATUS_TONE: Record<string, string> = {
  New: "bg-cream text-walnut-800", "Regulatory check": "bg-glow-50 text-glow-800", Sourcing: "bg-sage-50 text-sage-800",
  "Awaiting documents": "bg-glow-50 text-glow-800", "Approved by compliance": "bg-sage-100 text-sage-800", Fulfilled: "bg-sage-200 text-sage-900",
  Closed: "bg-slate-100 text-slate-700", Cancelled: "bg-red-50 text-red-700",
};

function RequestsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const meta = useMeta();
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [editing, setEditing] = React.useState<Req | "new" | null>(params.get("new") ? "new" : null);
  const openId = params.get("open");
  const list = useQuery({
    queryKey: ["npp-drug-requests", status, q, page],
    queryFn: () => api.get<{ items: Req[]; total: number; by_status: Record<string, number> }>("/drug-intel/requests", { status, q, page, page_size: 25 }),
    placeholderData: keepPreviousData,
  });
  React.useEffect(() => {
    if (openId) api.get<{ request: Req }>(`/drug-intel/requests/${openId}`).then((r) => setEditing(r.request)).catch(() => toast.error("Request not found"));
  }, [openId]);
  const close = () => { setEditing(null); if (params.get("new") || openId) router.replace("/drug-intel/requests"); };

  return (
    <div>
      <PageHeader title="NPP Medicine Requests" breadcrumb={<Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link>}
        description="Link each request to a medicine and track approval, marketing, stock and import checks separately."
        actions={<>
          <Button size="sm" variant="outline" onClick={() => api.download("/drug-intel/export", { tab: "requests", format: "csv" }, "NPP_Drug_Requests.csv")}><Download className="h-3.5 w-3.5" />Export</Button>
          <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" />New request</Button>
        </>} />
      <div className="mb-4 flex gap-2 rounded-xl border border-glow-200 bg-glow-50/60 px-3 py-2 text-xs text-walnut-800">
        <ShieldAlert className="h-4 w-4 shrink-0 text-glow-700" />
        Use a patient reference code only — never a patient&apos;s name, phone or ID number. Requests are visible only to the assigned department and Admin.
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {["", ...(meta.data?.request_statuses ?? [])].map((s) => (
          <button key={s || "all"} onClick={() => { setStatus(s); setPage(1); }}
            className={cn("rounded-full border px-3 py-1 text-xs font-semibold", status === s ? "border-walnut-700 bg-walnut-700 text-white" : "border-line bg-white text-ink-muted")}>
            {s || "All"}{s && list.data?.by_status[s] ? ` (${list.data.by_status[s]})` : ""}
          </button>
        ))}
        <Input className="ml-auto w-64" placeholder="Search medicine, request ID, doctor…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      <Card className="overflow-hidden">
        {list.error ? <ErrorState error={list.error} /> : list.isLoading ? <Skeleton className="m-4 h-48" /> : list.data?.items.length === 0 ? (
          <EmptyState title="No NPP medicine requests yet" description="Create one from a medicine's page or with New request." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead><tr><Th>Request</Th><Th>Medicine</Th><Th>Country</Th><Th>Treating doctor</Th><Th>Status</Th><Th>Regulatory check</Th><Th>Checks</Th><Th>Department</Th></tr></thead>
                <tbody>
                  {list.data?.items.map((r) => (
                    <tr key={r.id} className="cursor-pointer hover:bg-cream/40" onClick={() => setEditing(r)}>
                      <Td><b>{r.id}</b><p className="text-[11px] text-ink-soft">{formatDate(r.request_date)}{r.patient_reference_id && ` · Ref ${r.patient_reference_id}`}</p></Td>
                      <Td>{r.drug ? <Link onClick={(e) => e.stopPropagation()} href={`/drug-intel/drugs/${r.drug.id}`} className="font-semibold hover:underline">{r.drug.generic_name}</Link> : r.requested_drug_name}
                        <p className="text-[11px] text-ink-soft">{[r.brand_name, r.strength, r.dosage_form].filter(Boolean).join(" · ")}</p></Td>
                      <Td className="text-xs">{r.required_country ?? "—"}</Td>
                      <Td className="text-xs">{r.doctor?.doctor_name ?? r.treating_doctor ?? "—"}</Td>
                      <Td><span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[r.request_status])}>{r.request_status}</span></Td>
                      <Td className="text-xs">{r.regulatory_check_status}</Td>
                      <Td className="text-[11px]">{CHECKS.filter(([k]) => r[k] === "Confirmed").length}/5 confirmed</Td>
                      <Td className="text-xs">{DEPARTMENT_LABEL[r.assigned_department] ?? r.assigned_department}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <RequestDialog initial={editing === "new" ? null : editing} drugParam={params.get("drug")} onClose={close} />}
    </div>
  );
}

function RequestDialog({ initial, drugParam, onClose }: { initial: Req | null; drugParam: string | null; onClose: () => void }) {
  const { me } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const [drug, setDrug] = React.useState<{ id: string; generic_name: string; brand_names?: string[] } | null>(initial?.drug ?? null);
  const [f, setF] = React.useState({
    patient_reference_id: initial?.patient_reference_id ?? "", requested_drug_name: initial?.requested_drug_name ?? "",
    generic_name: initial?.generic_name ?? "", brand_name: initial?.brand_name ?? "", strength: initial?.strength ?? "",
    dosage_form: initial?.dosage_form ?? "", required_country: initial?.required_country ?? "", treating_doctor: initial?.treating_doctor ?? "",
    request_date: initial?.request_date ?? new Date().toISOString().slice(0, 10), request_status: initial?.request_status ?? "New",
    regulatory_check_status: initial?.regulatory_check_status ?? "Not started", approval_check: initial?.approval_check ?? "Not checked",
    marketing_check: initial?.marketing_check ?? "Not checked", stock_check: initial?.stock_check ?? "Not checked",
    import_check: initial?.import_check ?? "Not checked", patient_permission_check: initial?.patient_permission_check ?? "Not checked",
    assigned_department: initial?.assigned_department ?? (me?.role === "RARE_DISEASES" ? "RARE_DISEASES" : "NPP"), remarks: initial?.remarks ?? "",
  });
  const [doctor, setDoctor] = React.useState<{ id: string; doctor_name: string } | null>(initial?.doctor ?? null);
  const [docQ, setDocQ] = React.useState("");
  const docs = useQuery({
    queryKey: ["req-doctor-search", docQ],
    queryFn: () => api.get<Paged<DoctorRow>>("/doctors", { q: docQ, page_size: 8 }),
    enabled: docQ.trim().length >= 2,
  });

  React.useEffect(() => {
    if (!initial && drugParam) {
      api.get<{ drug: { id: string; generic_name: string; brand_names: string[] } }>(`/drug-intel/drugs/${drugParam}`).then((r) => setDrug(r.drug)).catch(() => undefined);
    }
  }, [initial, drugParam]);
  React.useEffect(() => {
    if (drug && !initial) setF((x) => ({ ...x, requested_drug_name: x.requested_drug_name || drug.generic_name, generic_name: x.generic_name || drug.generic_name }));
  }, [drug, initial]);

  const regulatory = useQuery({
    queryKey: ["drug-intel-drug", drug?.id],
    queryFn: () => api.get<{ matrix: MatrixCell[] }>(`/drug-intel/drugs/${drug!.id}`),
    enabled: !!drug,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v])), drug_id: drug?.id ?? null, doctor_id: doctor?.id ?? null };
      return initial ? api.put(`/drug-intel/requests/${initial.id}`, body) : api.post<{ id: string }>("/drug-intel/requests", body);
    },
    onSuccess: (r) => {
      toast.success(initial ? "Request updated" : `Request ${(r as { id: string }).id} created`);
      qc.invalidateQueries({ queryKey: ["npp-drug-requests"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const refBad = f.patient_reference_id !== "" && !/^[A-Za-z0-9/_-]{1,40}$/.test(f.patient_reference_id);
  const country = meta.data?.countries.find((c) => c.name === f.required_country || c.code === f.required_country);
  const cells = regulatory.data?.matrix ?? [];
  const focus = country ? cells.filter((c) => c.country === country.code) : cells;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={initial ? `Request ${initial.id}` : "New NPP medicine request"}
      description={initial ? `Created by ${initial.created_by ?? "—"} on ${formatDateTime(initial.created_at)}` : "Search the medicine, pick the source country, then track each check."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !f.requested_drug_name.trim() || refBad}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{initial ? "Save" : "Create request"}</Button></>}>
      <div className="space-y-4">
        <div><Label>1. Medicine (from the international database)</Label><DrugPicker value={drug} onChange={(d) => setDrug(d)} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Requested drug name (as prescribed) *</Label><Input value={f.requested_drug_name} onChange={set("requested_drug_name")} /></div>
          <div><Label>Generic name</Label><Input value={f.generic_name} onChange={set("generic_name")} /></div>
          <div><Label>Brand name</Label><Input value={f.brand_name} onChange={set("brand_name")} /></div>
          <div className="grid grid-cols-2 gap-2"><div><Label>Strength</Label><Input value={f.strength} onChange={set("strength")} /></div><div><Label>Dosage form</Label><Input value={f.dosage_form} onChange={set("dosage_form")} /></div></div>
          <div><Label>2. Required (source) country</Label>
            <Select value={f.required_country} onChange={set("required_country")}>
              <option value="">Choose…</option>{meta.data?.countries.map((c) => <option key={c.code} value={c.name}>{c.name}</option>)}
            </Select>
          </div>
          <div><Label>Patient reference code (no names)</Label><Input value={f.patient_reference_id} onChange={set("patient_reference_id")} placeholder="e.g. NPP-2026-014" />
            {refBad && <p className="mt-1 text-[11px] text-red-600">Letters, numbers, - _ / only. Never the patient&apos;s name.</p>}</div>
          <div><Label>Treating doctor</Label>
            {doctor ? (
              <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm"><span>{doctor.doctor_name}</span><button className="text-xs font-semibold text-sage-700" onClick={() => setDoctor(null)}>Change</button></div>
            ) : (
              <div className="relative">
                <Input value={docQ} onChange={(e) => setDocQ(e.target.value)} placeholder="Search your doctors…" />
                {docQ.trim().length >= 2 && (
                  <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-white shadow-pop">
                    {docs.data?.items.map((d) => <button key={d.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-sage-50" onClick={() => { setDoctor(d); setF({ ...f, treating_doctor: d.doctor_name }); setDocQ(""); }}>{d.doctor_name} <span className="text-xs text-ink-soft">{d.institute}</span></button>)}
                    {docs.data?.items.length === 0 && <p className="px-3 py-2 text-xs text-ink-soft">No match — type the name below.</p>}
                  </div>
                )}
                <Input className="mt-1" value={f.treating_doctor} onChange={set("treating_doctor")} placeholder="…or type the doctor's name" />
              </div>
            )}
          </div>
          <div><Label>Request date</Label><Input type="date" value={f.request_date} onChange={set("request_date")} /></div>
          <div><Label>Request status</Label><Select value={f.request_status} onChange={set("request_status")}>{meta.data?.request_statuses.map((s) => <option key={s}>{s}</option>)}</Select></div>
          <div><Label>Regulatory check status</Label><Select value={f.regulatory_check_status} onChange={set("regulatory_check_status")}>{meta.data?.regulatory_checks.map((s) => <option key={s}>{s}</option>)}</Select></div>
          {me?.role === "ADMIN" && (
            <div><Label>Assigned department</Label><Select value={f.assigned_department} onChange={set("assigned_department")}><option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option></Select></div>
          )}
        </div>

        {drug && (
          <div>
            <Label>3. Verified approval information {country ? `— ${country.name}` : "(all countries)"}</Label>
            {regulatory.isLoading ? <Skeleton className="h-20" /> : <CountryMatrix cells={focus} compact />}
            {country && focus[0] && !focus[0].has_record && (
              <p className="mt-1 text-[11px] text-ink-soft">No check recorded for {country.name}. This does not mean it is unapproved — ask Admin to verify it in the official register.</p>
            )}
          </div>
        )}

        <div>
          <Label>4. Checks (each one is separate)</Label>
          <div className="mt-1 flex gap-2 rounded-lg bg-red-50/70 px-3 py-2 text-[11px] text-red-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Approval in the USA, Europe or Japan does not by itself mean the medicine can be imported into India or supplied under an NPP. Import eligibility is decided by the compliance team.
          </div>
          <div className="mt-2 space-y-2">
            {CHECKS.map(([k, label, help]) => (
              <div key={k} className="grid items-center gap-2 sm:grid-cols-[1fr_180px]">
                <div><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-ink-soft">{help}</p></div>
                <Select value={f[k as keyof typeof f]} onChange={set(k as keyof typeof f)}>{meta.data?.check_values.map((v) => <option key={v}>{v}</option>)}</Select>
              </div>
            ))}
          </div>
        </div>
        <div><Label>Remarks</Label><Textarea rows={3} value={f.remarks} onChange={set("remarks")} placeholder="No patient-identifying details" /></div>
        {drug && regulatory.data && <p className="text-[11px] text-ink-soft">Linked to <Link className="font-semibold text-sage-700 hover:underline" href={`/drug-intel/drugs/${drug.id}`}>{drug.generic_name} ({drug.id})</Link>.{" "}
          {regulatory.data.matrix.filter((m) => m.status === "Approved").length > 0 && <>Approved in: {regulatory.data.matrix.filter((m) => m.status === "Approved").map((m) => m.name).join(", ")}.</>}</p>}
        {initial && <p className="text-[11px] text-ink-soft">Every change is recorded in the audit log.</p>}
      </div>
    </Dialog>
  );
}

export default function RequestsPage() {
  return <React.Suspense fallback={<Skeleton className="h-96" />}><RequestsInner /></React.Suspense>;
}
