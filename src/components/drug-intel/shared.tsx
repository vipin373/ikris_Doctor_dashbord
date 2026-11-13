"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Info, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";

export const STATUSES = [
  "Approved", "Under Review", "Withdrawn", "Suspended", "Refused", "Expired", "Not Verified", "No Approval Record Found",
] as const;
export type ApprovalStatus = (typeof STATUSES)[number];

export interface DrugRow {
  id: string; generic_name: string; brand_names: string[]; kegg_drug_id: string | null; therapeutic_area: string | null;
  manufacturer: string | null; mah: string | null; us_status: string | null; us_date: string | null; eu_status: string | null;
  eu_date: string | null; uk_status: string | null; jp_status: string | null; jp_date: string | null; is_orphan: boolean;
  orphan_eu: boolean | null; orphan_us: boolean | null; orphan_jp: boolean | null; is_oncology: boolean; is_rare: boolean;
  last_verified: string | null; verification_status: string; approved_regions: number; mapped_doctors: number;
  latest_approval_date: string | null; first_approval_date: string | null; pending_verification: boolean;
}
export interface Approval {
  id: string; drug_id: string; country: string; region: string; authority: string | null; approval_status: string;
  approval_date: string | null; application_number: string | null; ma_number: string | null; approval_type: string | null;
  indication_approved: string | null; label_url: string | null; source_url: string | null; marketing_status: string | null;
  source_checked: string | null; search_terms: string | null; last_verified_date: string | null; verified_by: string | null;
  verification_notes: string | null; data_origin: string; locked: boolean;
}
export interface MatrixCell { country: string; name: string; region: string; authority: string; record: Approval | null; status: string; has_record: boolean }
export interface Meta {
  statuses: string[]; areas: string[]; countries: { code: string; name: string; region: string; authority: string }[];
  matrix: string[]; request_statuses: string[]; regulatory_checks: string[]; check_values: string[]; departments: string[]; is_admin: boolean;
}

export function useMeta() {
  return useQuery({ queryKey: ["drug-intel-meta"], queryFn: () => api.get<Meta>("/drug-intel/meta"), staleTime: 300_000 });
}

const TONE: Record<string, string> = {
  Approved: "bg-sage-100 text-sage-800 ring-sage-300",
  "Under Review": "bg-glow-50 text-glow-800 ring-glow-200",
  Withdrawn: "bg-red-50 text-red-700 ring-red-100",
  Suspended: "bg-red-50 text-red-700 ring-red-100",
  Refused: "bg-red-50 text-red-700 ring-red-100",
  Expired: "bg-walnut-50 text-walnut-700 ring-walnut-200",
  "No Approval Record Found": "bg-cream text-walnut-800 ring-walnut-200",
  "Not Verified": "bg-white text-ink-soft ring-line border border-dashed border-slate-300",
};

/** One controlled status. A missing record is shown as "Not Verified" — never as "not approved". */
export function StatusBadge({ status, className, small }: { status?: string | null; className?: string; small?: boolean }) {
  const s = status || "Not Verified";
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md font-semibold ring-1 ring-inset",
      small ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-0.5 text-[11px]", TONE[s] ?? TONE["Not Verified"], className)}
      title={s === "Not Verified" ? "No check has been recorded for this jurisdiction yet. This does not mean the medicine is unapproved." :
        s === "No Approval Record Found" ? "The checked source returned no record. This does not prove that no approval exists." : undefined}>
      {s}
    </span>
  );
}

export function OrphanLabel({ d }: { d: { orphan_eu: boolean | null; orphan_us: boolean | null; orphan_jp: boolean | null } }) {
  const parts = [d.orphan_eu && "EU", d.orphan_us && "US", d.orphan_jp && "Japan"].filter(Boolean);
  if (parts.length) return <span className="inline-flex rounded-md bg-walnut-50 px-1.5 py-0.5 text-[11px] font-semibold text-walnut-700 ring-1 ring-inset ring-walnut-200">Orphan ({parts.join(", ")})</span>;
  if (d.orphan_eu === false) return <span className="text-xs text-ink-soft">Not EU orphan</span>;
  return <span className="text-xs text-ink-soft">Not verified</span>;
}

export function SourceLink({ href, children, className }: { href?: string | null; children?: React.ReactNode; className?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-xs font-medium text-sage-700 hover:underline", className)}>
      {children ?? "Source"} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function RuleNotice({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-2 rounded-xl border border-glow-200 bg-glow-50/60 px-3 py-2 text-xs leading-relaxed text-walnut-800", className)}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-glow-700" />
      <p>
        <b>How to read statuses:</b> &ldquo;Not Verified&rdquo; means nobody has checked that country yet — it does <b>not</b> mean unapproved.
        Regulatory approval is not the same as marketing, stock, or permission to import into India. Import or NPP eligibility must be confirmed by the compliance team.
      </p>
    </div>
  );
}

/** Country approval matrix for one medicine. */
export function CountryMatrix({ cells, drugId, isAdmin, compact }: { cells: MatrixCell[]; drugId?: string; isAdmin?: boolean; compact?: boolean }) {
  const [edit, setEdit] = React.useState<MatrixCell | null>(null);
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2">Country</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Approval date</th>
              <th className="px-3 py-2">Authority</th>{!compact && <th className="px-3 py-2">Reference</th>}
              <th className="px-3 py-2">Last verified</th><th className="px-3 py-2">Source</th>{isAdmin && drugId && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.country} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <p className="font-semibold text-ink">{c.name}</p>
                  <p className="text-[11px] text-ink-soft">{c.country} · {c.region}</p>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                  {c.record?.locked && <span title="Verified by a person — automatic imports will not overwrite it" className="ml-1 inline-flex align-middle text-sage-700"><Lock className="h-3 w-3" /></span>}
                  {c.record?.marketing_status && <p className="mt-1 text-[11px] text-ink-soft">Marketing: {c.record.marketing_status}</p>}
                </td>
                <td className="px-3 py-2 text-xs tabular-nums">{c.record?.approval_date ? formatDate(c.record.approval_date) : "—"}</td>
                <td className="px-3 py-2 text-xs">{c.authority}</td>
                {!compact && (
                  <td className="max-w-[240px] px-3 py-2 text-[11px] text-ink-muted">
                    {[c.record?.approval_type, c.record?.application_number, c.record?.ma_number].filter(Boolean).join(" · ") || "—"}
                    {c.record?.verification_notes && <p className="mt-1 text-ink-soft">{c.record.verification_notes}</p>}
                  </td>
                )}
                <td className="px-3 py-2 text-[11px] text-ink-soft">
                  {c.record?.last_verified_date ? formatDate(c.record.last_verified_date) : "Not checked"}
                  {c.record?.verified_by && <p>by {c.record.verified_by}</p>}
                </td>
                <td className="space-y-1 px-3 py-2">
                  <SourceLink href={c.record?.source_url}>Record</SourceLink>
                  {c.record?.label_url && <div><SourceLink href={c.record.label_url}>Label</SourceLink></div>}
                </td>
                {isAdmin && drugId && (
                  <td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => setEdit(c)}><ShieldCheck className="h-3.5 w-3.5" />Verify</Button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && drugId && <VerifyDialog open onOpenChange={(v) => !v && setEdit(null)} drugId={drugId} cell={edit} />}
    </>
  );
}

/** Admin records what was checked in an official source for one jurisdiction. Kept in history. */
export function VerifyDialog({ open, onOpenChange, drugId, cell, countries }: {
  open: boolean; onOpenChange: (v: boolean) => void; drugId: string; cell?: MatrixCell | null;
  countries?: { code: string; name: string }[];
}) {
  const qc = useQueryClient();
  const r = cell?.record;
  const [f, setF] = React.useState({
    country: cell?.country ?? "JP", approval_status: r?.approval_status ?? "Approved", approval_date: r?.approval_date ?? "",
    authority: r?.authority ?? cell?.authority ?? "", application_number: r?.application_number ?? "", ma_number: r?.ma_number ?? "",
    approval_type: r?.approval_type ?? "", label_url: r?.label_url ?? "", source_url: r?.source_url ?? "",
    marketing_status: r?.marketing_status ?? "", source_checked: r?.source_checked ?? "", search_terms: r?.search_terms ?? "",
    verification_notes: r?.verification_notes ?? "", indication_approved: r?.indication_approved ?? "", lock: true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => api.put(`/drug-intel/drugs/${drugId}/approvals/${f.country}`, {
      ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== "country").map(([k, v]) => [k, v === "" ? null : v])),
    }),
    onSuccess: () => {
      toast.success("Verification saved and added to the history");
      qc.invalidateQueries({ queryKey: ["drug-intel-drug", drugId] });
      qc.invalidateQueries({ queryKey: ["drug-intel-list"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const needsSource = f.approval_status !== "Not Verified";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={`Record verification${cell ? ` — ${cell.name}` : ""}`}
      description="Enter only what the official register shows. Never guess a date or status."
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || (needsSource && (!f.source_url || !f.search_terms))}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save verification
        </Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!cell && countries && (
          <div><Label>Country</Label>
            <Select value={f.country} onChange={set("country")}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</Select>
          </div>
        )}
        <div><Label>Approval status</Label>
          <Select value={f.approval_status} onChange={set("approval_status")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        </div>
        <div><Label>Approval date (as shown in source)</Label><Input type="date" value={f.approval_date} onChange={set("approval_date")} /></div>
        <div><Label>Regulatory authority</Label><Input value={f.authority} onChange={set("authority")} /></div>
        <div className="sm:col-span-2"><Label>Official source link checked {needsSource && <span className="text-red-600">*</span>}</Label>
          <Input placeholder="https://…" value={f.source_url} onChange={set("source_url")} /></div>
        <div><Label>Search terms used {needsSource && <span className="text-red-600">*</span>}</Label><Input value={f.search_terms} onChange={set("search_terms")} placeholder="e.g. imatinib, Glivec" /></div>
        <div><Label>Source checked (register name)</Label><Input value={f.source_checked} onChange={set("source_checked")} placeholder="e.g. PMDA approved products list" /></div>
        <div><Label>Application number</Label><Input value={f.application_number} onChange={set("application_number")} /></div>
        <div><Label>Marketing authorisation number</Label><Input value={f.ma_number} onChange={set("ma_number")} /></div>
        <div><Label>Approval type</Label><Input value={f.approval_type} onChange={set("approval_type")} placeholder="e.g. National, MRP/DCP, EU centralised" /></div>
        <div><Label>Product label link</Label><Input value={f.label_url} onChange={set("label_url")} placeholder="https://…" /></div>
        <div className="sm:col-span-2"><Label>Marketing status (only if the source states it)</Label><Input value={f.marketing_status} onChange={set("marketing_status")} /></div>
        <div className="sm:col-span-2"><Label>Approved indication</Label><Textarea rows={2} value={f.indication_approved} onChange={set("indication_approved")} /></div>
        <div className="sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={f.verification_notes} onChange={set("verification_notes")} /></div>
        <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-2">
          <input type="checkbox" checked={f.lock} onChange={(e) => setF({ ...f, lock: e.target.checked })} />
          Protect this record from automatic source imports
        </label>
      </div>
    </Dialog>
  );
}

/** Small search box returning a drug (for mapping and requests). */
export function DrugPicker({ value, onChange, placeholder }: { value: { id: string; generic_name: string } | null; onChange: (d: DrugRow | null) => void; placeholder?: string }) {
  const [q, setQ] = React.useState("");
  const [deb, setDeb] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDeb(q), 300); return () => clearTimeout(t); }, [q]);
  const res = useQuery({
    queryKey: ["drug-intel-pick", deb],
    queryFn: () => api.get<{ items: DrugRow[] }>("/drug-intel/drugs", { q: deb, page_size: 8 }),
    enabled: deb.trim().length >= 2,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-sm">
        <span><b>{value.generic_name}</b> <span className="text-xs text-ink-soft">{value.id}</span></span>
        <button className="text-xs font-semibold text-sage-700 hover:underline" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? "Search generic or brand name…"} />
      {deb.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-white shadow-pop">
          {res.isLoading && <p className="px-3 py-2 text-xs text-ink-soft">Searching…</p>}
          {res.data?.items.length === 0 && <p className="px-3 py-2 text-xs text-ink-soft">No medicine found in the database.</p>}
          {res.data?.items.map((d) => (
            <button key={d.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-sage-50" onClick={() => { onChange(d); setQ(""); }}>
              <b>{d.generic_name}</b> <span className="text-xs text-ink-soft">{d.brand_names.slice(0, 3).join(", ")}</span>
              <span className="ml-2 inline-flex gap-1 align-middle"><StatusBadge small status={d.us_status} /><StatusBadge small status={d.eu_status} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DrugLink({ id, name }: { id: string; name: string }) {
  return <Link href={`/drug-intel/drugs/${id}`} className="font-semibold text-walnut-800 hover:text-sage-700 hover:underline">{name}</Link>;
}
