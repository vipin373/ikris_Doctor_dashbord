"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCw, Upload, XCircle } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { formatDateTime, number } from "@/lib/utils";

interface Run { id: string; source: string; status: string; counts: Record<string, number>; errors: { name?: string; row?: number; error?: string; errors?: string[] }[]; started_by: string | null; started_at: string; finished_at: string | null }
interface Preview {
  valid: number; invalid: number; errors: { row: number; name: string; errors: string[] }[];
  preview: { row: number; name: string; matches: string; country?: string; status?: string; fields?: string[] }[];
  applied?: boolean; counts?: Record<string, number>;
}

const TABS = [
  ["master", "International_Drug_Master"], ["approvals", "Drug_Country_Approval"], ["indications", "Drug_Indications"],
  ["history", "Drug_Regulatory_History"], ["requests", "NPP_Drug_Requests"],
] as const;

async function uploadTable(file: File, kind: string, apply: boolean): Promise<Preview> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  form.append("apply", String(apply));
  const { data } = await supabase().auth.getSession();
  const res = await fetch("/api/drug-intel/import/file", { method: "POST", body: form, headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Upload failed");
  return body as Preview;
}

function PreviewView({ p }: { p: Preview }) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p><b className="text-sage-700">{number(p.valid)}</b> valid rows · <b className={p.invalid ? "text-red-600" : ""}>{number(p.invalid)}</b> with problems</p>
      {p.applied && p.counts && <p className="rounded-lg bg-sage-50 px-3 py-2 text-xs text-sage-800">Applied: {Object.entries(p.counts).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}</p>}
      {p.errors.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-red-100 bg-red-50/50 p-2 text-xs">
          {p.errors.map((e) => <p key={e.row}>Row {e.row} ({e.name}): {e.errors.join("; ")}</p>)}
        </div>
      )}
      {!p.applied && p.preview.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-line text-xs">
          <table className="w-full"><tbody>
            {p.preview.map((r) => (
              <tr key={r.row} className="border-b border-line"><td className="px-2 py-1 text-ink-soft">{r.row}</td><td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1">{r.country ?? r.fields?.join(", ")}</td><td className="px-2 py-1">{r.status}</td>
                <td className="px-2 py-1 text-ink-soft">{r.matches === "new record" ? <span className="text-glow-700">new record</span> : r.matches}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

export default function DrugImportPage() {
  const { me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["drug-intel-runs"], queryFn: () => api.get<{ items: Run[]; sources: Record<string, string> }>("/drug-intel/import/runs") });
  const afterImport = () => { ["drug-intel-runs", "drug-intel-summary", "drug-intel-list", "drug-intel-reports"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const sync = useMutation({
    mutationFn: (src: "fda" | "ema") => api.post<{ counts: Record<string, number> }>(`/drug-intel/import/${src}`),
    onSuccess: (r) => { toast.success(`Done: ${number(r.counts.drugs_created ?? 0)} new medicines, ${number(r.counts.approvals_changed ?? 0)} changed records`); afterImport(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const emaFile = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append("file", f);
      const { data } = await supabase().auth.getSession();
      const res = await fetch("/api/drug-intel/import/ema-file", { method: "POST", body: form, headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Upload failed");
      return body as { counts: Record<string, number> };
    },
    onSuccess: (r) => { toast.success(`EMA file imported: ${number(r.counts.substances_in_file ?? 0)} substances`); afterImport(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [file, setFile] = React.useState<File | null>(null);
  const [kind, setKind] = React.useState("approvals");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const fileRun = useMutation({
    mutationFn: (apply: boolean) => uploadTable(file!, kind, apply),
    onSuccess: (p) => { setPreview(p); if (p.applied) { toast.success("Imported"); afterImport(); } },
    onError: (e: Error) => toast.error(e.message),
  });

  const [sheet, setSheet] = React.useState({ url: "", tab: "Drug_Country_Approval", kind: "approvals" });
  const [sheetPreview, setSheetPreview] = React.useState<Preview | null>(null);
  const sheetRun = useMutation({
    mutationFn: (apply: boolean) => api.post<Preview>("/drug-intel/import/sheet", { ...sheet, apply }),
    onSuccess: (p) => { setSheetPreview(p); if (p.applied) { toast.success("Imported from Google Sheet"); afterImport(); } },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Data Import & Sync" breadcrumb={<Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link>}
        description="Official sources are the authority for regulatory facts. Records a person has verified are never overwritten by automatic imports." />

      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin && (
          <Card>
            <CardHeader title="Sync from official sources" description="Safe to run any time; unchanged records stay unchanged and every status change is kept in history." />
            <CardBody className="space-y-3">
              {([["fda", "USA — openFDA Drugs@FDA", "NDA/BLA approvals (public US Government data). About 15 seconds."],
                ["ema", "EU — EMA medicines data", "EU centralised authorisations, refusals and withdrawals. Source: European Medicines Agency (EMA)."]] as const).map(([k, title, help]) => (
                <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                  <div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-ink-soft">{help}</p></div>
                  <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => sync.mutate(k)} disabled={sync.isPending}>
                    {sync.isPending && sync.variables === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Sync now
                  </Button>
                </div>
              ))}
              <label className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-xs text-ink-muted">
                <span>If EMA blocks automatic download, get the <a className="text-sage-700 underline" href="https://www.ema.europa.eu/en/medicines/download-medicine-data" target="_blank" rel="noopener noreferrer">“Medicines” Excel file</a> and upload it:</span>
                <input type="file" accept=".xlsx" className="text-xs" disabled={emaFile.isPending} onChange={(e) => e.target.files?.[0] && emaFile.mutate(e.target.files[0])} />
                {emaFile.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </label>
              <div className="rounded-xl border border-dashed border-line p-3 text-xs text-ink-muted">
                <p className="font-semibold text-ink">Japan (PMDA), UK (MHRA) and national EU registers</p>
                PMDA, MHRA and national registers do not offer an open bulk dataset we may automatically import, so these are added by a person:
                fill the <b>Drug_Country_Approval</b> template (or the Google Sheet tab) with what the official register shows and upload it below, or use <Link href="/drug-intel/verification" className="text-sage-700 underline">Regulatory verification</Link> one by one.
              </div>
              <div className="rounded-xl border border-dashed border-line p-3 text-xs text-ink-muted">
                <p className="font-semibold text-ink">KEGG</p>
                KEGG&apos;s terms require a commercial licence for non-academic use, so KEGG records are not imported. KEGG IDs can be added by hand or in the master template once Ikris holds a licence.
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Export (Google Sheets tab layout)" description="Download and paste into the matching tab, or keep as Excel." />
          <CardBody className="space-y-2">
            <Button size="sm" onClick={() => api.download("/drug-intel/export", { tab: "all", format: "xlsx" }, "Ikris_Drug_Intelligence.xlsx")}><FileSpreadsheet className="h-3.5 w-3.5" />All 5 tabs (Excel)</Button>
            <div className="grid gap-2 sm:grid-cols-2">
              {TABS.map(([k, name]) => (
                <Button key={k} size="sm" variant="outline" onClick={() => api.download("/drug-intel/export", { tab: k, format: "csv" }, `${name}.csv`)}><Download className="h-3.5 w-3.5" />{name}</Button>
              ))}
            </div>
            <p className="text-[11px] text-ink-soft">Automatic write-back into your Google Sheet needs a Google service account on the server (the same one needed for doctor sheets). Until then, use these exports.</p>
          </CardBody>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader title="Upload verified records (CSV or Excel)" description="Preview first. Every non-'Not Verified' row must include the official source link you checked." />
            <CardBody className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div><Label>Tab type</Label>
                  <Select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); }}>
                    <option value="approvals">Drug_Country_Approval (Japan, UK, national…)</option>
                    <option value="master">International_Drug_Master (corrections, KEGG IDs)</option>
                  </Select>
                </div>
                <div><Label>File</Label><Input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => api.download("/drug-intel/template", { kind }, `${kind}_template.csv`)}><Download className="h-3.5 w-3.5" />Template</Button>
                <Button size="sm" variant="secondary" disabled={!file || fileRun.isPending} onClick={() => fileRun.mutate(false)}><Upload className="h-3.5 w-3.5" />Preview</Button>
                <Button size="sm" disabled={!file || !preview || preview.applied || preview.valid === 0 || fileRun.isPending} onClick={() => fileRun.mutate(true)}>
                  {fileRun.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Import {preview ? number(preview.valid) : ""} valid rows
                </Button>
              </div>
              {preview && <PreviewView p={preview} />}
            </CardBody>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardHeader title="Import from a Google Sheet tab" description="Share the sheet as 'Anyone with the link can view'. Same rules as file upload." />
            <CardBody className="space-y-3">
              <div><Label>Google Sheet link</Label><Input value={sheet.url} onChange={(e) => setSheet({ ...sheet, url: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" /></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><Label>Tab name</Label><Input value={sheet.tab} onChange={(e) => setSheet({ ...sheet, tab: e.target.value })} /></div>
                <div><Label>Tab type</Label>
                  <Select value={sheet.kind} onChange={(e) => setSheet({ ...sheet, kind: e.target.value, tab: e.target.value === "master" ? "International_Drug_Master" : "Drug_Country_Approval" })}>
                    <option value="approvals">Drug_Country_Approval</option><option value="master">International_Drug_Master</option>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={!sheet.url || sheetRun.isPending} onClick={() => sheetRun.mutate(false)}>Preview</Button>
                <Button size="sm" disabled={!sheetPreview || sheetPreview.applied || sheetPreview.valid === 0 || sheetRun.isPending} onClick={() => sheetRun.mutate(true)}>
                  {sheetRun.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Sync now
                </Button>
              </div>
              {sheetPreview && <PreviewView p={sheetPreview} />}
            </CardBody>
          </Card>
        )}
      </div>

      <Card className="mt-4">
        <CardHeader title="Import log" description="Every import with its counts and any rows that were skipped" />
        <CardBody className="p-0">
          {runs.isLoading ? <Skeleton className="m-4 h-24" /> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2">When</th><th className="px-2 py-2">Source</th><th className="px-2 py-2">Result</th><th className="px-2 py-2">Counts</th><th className="px-4 py-2">Skipped rows</th>
              </tr></thead>
              <tbody>
                {runs.data?.items.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-4 py-2 text-xs">{formatDateTime(r.started_at)}<p className="text-ink-soft">{r.started_by}</p></td>
                    <td className="px-2 py-2 text-xs font-semibold">{r.source}</td>
                    <td className="px-2 py-2 text-xs">{r.status === "failed" ? <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="h-3.5 w-3.5" />failed</span> : <span className="inline-flex items-center gap-1 text-sage-700"><CheckCircle2 className="h-3.5 w-3.5" />{r.status === "running" ? "running" : "done"}</span>}</td>
                    <td className="px-2 py-2 text-[11px] text-ink-muted">{Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${number(v)}`).join(" · ") || "—"}</td>
                    <td className="max-w-[320px] px-4 py-2 text-[11px] text-ink-soft">
                      {r.errors.length === 0 ? "None" : (
                        <details><summary className="cursor-pointer">{r.errors.length} rows</summary>
                          {r.errors.slice(0, 30).map((e, i) => <p key={i}>{e.row ? `Row ${e.row} ` : ""}{e.name}: {e.error ?? e.errors?.join("; ")}</p>)}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      {runs.data?.sources && (
        <p className="mt-3 text-[11px] text-ink-soft">Sources &amp; terms: {Object.entries(runs.data.sources).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="mr-3 text-sage-700 underline">{k}</a>)}</p>
      )}
    </div>
  );
}
