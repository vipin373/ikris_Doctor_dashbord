"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, FileSpreadsheet, Loader2, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, PageHeader, Skeleton, Switch, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { SheetSource, SheetTab, SyncLog, SyncResult } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDateTime, number } from "@/lib/utils";

type Connections = { sources: SheetSource[]; google_service_account: string | null; service_role_configured: boolean };

const STEPS = [
  "Reading Google Sheets…", "Reading tabs…", "Processing records…", "Checking duplicates…",
  "Updating doctors…", "Adding new doctors…", "Sync completed.",
];

export default function GoogleSheetsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = React.useState(-1);
  const [result, setResult] = React.useState<SyncResult | null>(null);
  const [editing, setEditing] = React.useState<SheetTab | null>(null);
  const conn = useQuery({ queryKey: ["sheets"], queryFn: () => api.get<Connections>("/google-sheets"), enabled: me?.role === "ADMIN" });
  const history = useQuery({ queryKey: ["sync-history"], queryFn: () => api.get<SyncLog[]>("/google-sheets/sync-history"), enabled: me?.role === "ADMIN" });

  const sync = useMutation({
    mutationFn: () => api.post<SyncResult>("/google-sheets/sync"),
    onMutate: () => {
      setResult(null);
      setStep(0);
    },
    onSuccess: (r) => {
      setStep(STEPS.length - 1);
      setResult(r);
      qc.invalidateQueries();
      if (r.status === "success") toast.success("Sync completed");
      else if (r.status === "partial") toast.warning("Sync completed with errors");
      else toast.error("Sync failed");
    },
    onError: (err) => {
      setStep(-1);
      toast.error(err instanceof Error ? err.message : "Sync failed");
      history.refetch();
    },
  });

  React.useEffect(() => {
    if (!sync.isPending) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 2)), 900);
    return () => clearInterval(t);
  }, [sync.isPending]);

  if (me && me.role !== "ADMIN") return <Card><EmptyState title="Administrator access required" /></Card>;
  if (conn.error) return <ErrorState error={conn.error} onRetry={() => conn.refetch()} />;

  const sources = conn.data?.sources ?? [];
  const rows = sources.flatMap((s) => s.tabs.map((t) => ({ source: s, tab: t })));
  const enabled = rows.filter((r) => r.tab.is_enabled && r.tab.data_kind !== "ignore");
  const publicTabs = enabled.filter((r) => (r.tab.mapping as { access_mode?: string })?.access_mode === "public_link" || !conn.data?.google_service_account);

  return (
    <div>
      <PageHeader
        title="Google Sheets Sync Center"
        description="Google Sheets stay your working source. Sync copies them into the platform one way: new rows are added, changed rows updated, nothing is deleted."
        actions={
          <Button onClick={() => sync.mutate()} disabled={sync.isPending || !conn.data?.service_role_configured}>
            {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync now
          </Button>
        }
      />

      {conn.data && !conn.data.service_role_configured && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Sync is disabled: <b>SUPABASE_SERVICE_ROLE_KEY</b> is not set on the server. Add it in Vercel → Project → Settings → Environment Variables and redeploy.
        </div>
      )}
      {publicTabs.length > 0 && (
        <div className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>{publicTabs.length} tabs are read through their public “Anyone with the link” share.</b> Anyone who has those links can see doctor and patient contact details.
            Recommended: create a Google service account, share each sheet with it as Viewer, set <code>GOOGLE_CLIENT_EMAIL</code> / <code>GOOGLE_PRIVATE_KEY</code>, then switch the sheets to “Restricted”.
            {conn.data?.google_service_account && <> Service account: <code>{conn.data.google_service_account}</code></>}
          </div>
        </div>
      )}

      {(step >= 0 || result) && (
        <Card className="mb-5">
          <CardHeader title={sync.isPending ? "Sync in progress" : "Last sync result"} />
          <CardBody>
            <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
              <ol className="space-y-2">
                {STEPS.map((label, i) => {
                  const done = result ? true : i < step;
                  const active = !result && i === step;
                  return (
                    <li key={label} className={cn("flex items-center gap-2 text-sm", done ? "text-ink" : active ? "text-brand-800" : "text-ink-soft")}>
                      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Circle className="h-4 w-4" />}
                      {label}
                    </li>
                  );
                })}
              </ol>
              {result && (
                <div>
                  <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
                    {([
                      ["New", result.new, "text-emerald-700"], ["Updated", result.updated, "text-brand-700"], ["Unchanged", result.unchanged, "text-ink"],
                      ["Duplicates", result.duplicates, "text-amber-700"], ["Flagged missing", result.flagged_missing, "text-amber-700"], ["Errors", result.errors, "text-red-700"],
                    ] as const).map(([label, value, cls]) => (
                      <div key={label} className="rounded-md border border-line px-3 py-2">
                        <p className="text-[11px] text-ink-soft">{label}</p>
                        <p className={cn("text-xl font-semibold tabular-nums", cls)}>{number(value)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-ink-soft">
                    {number(result.new_events)} new outreach events recorded. “Duplicates” are sheet rows that describe a doctor already present (same email, phone, or name and hospital); they are merged, not added twice.
                  </p>
                  {result.tabs.filter((t) => t.status === "Failed" || t.errors.length > 0).map((t) => (
                    <p key={t.tab_id} className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-800">
                      <b>{t.source} / {t.tab}:</b> {t.error ?? `${t.errors.length} rows could not be read (for example: ${JSON.stringify(t.errors[0])})`}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Connected sheets and tabs" description="Tabs are mapped to a department; new tabs are discovered automatically when a service account is configured." />
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th>Department</Th><Th>Spreadsheet</Th><Th>Sheet tab</Th><Th>Data</Th><Th className="text-right">Records</Th><Th>Last sync</Th><Th>Status</Th><Th>Enabled</Th><Th />
              </tr>
            </thead>
            <tbody>
              {conn.isLoading && Array.from({ length: 5 }).map((_, i) => <tr key={i}><Td colSpan={9}><Skeleton className="h-5" /></Td></tr>)}
              {rows.map(({ source, tab }) => (
                <tr key={tab.id} className={cn(!tab.is_enabled && "bg-slate-50/60 text-ink-soft")}>
                  <Td>{tab.department_code ? <Badge tone={departmentTone(tab.department_code)}>{DEPARTMENT_LABEL[tab.department_code]}</Badge> : <span className="text-ink-soft">—</span>}</Td>
                  <Td>
                    <a href={`https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}/edit`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-brand-700">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-700" />{source.name}<ExternalLink className="h-3 w-3 text-ink-soft" />
                    </a>
                  </Td>
                  <Td>{tab.tab_name}{tab.sub_department && <span className="block text-xs text-ink-soft">→ {tab.sub_department}</span>}</Td>
                  <Td><Badge tone={tab.data_kind === "doctors" ? "brand" : tab.data_kind === "feedback" ? "sky" : "neutral"}>{tab.data_kind === "ignore" ? "Not synced" : tab.data_kind}</Badge></Td>
                  <Td className="text-right tabular-nums">{tab.data_kind === "ignore" ? "—" : number(tab.record_count)}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(tab.last_synced_at)}</Td>
                  <Td>
                    {tab.last_status ? <Badge tone={statusTone(tab.last_status)}>{tab.last_status}</Badge> : <span className="text-xs text-ink-soft">Never synced</span>}
                    {tab.last_error && <p className="mt-1 max-w-xs text-[11px] text-red-700">{tab.last_error}</p>}
                  </Td>
                  <Td><TabToggle tab={tab} /></Td>
                  <Td><Button size="icon" variant="ghost" aria-label="Edit mapping" onClick={() => setEditing(tab)}><Pencil className="h-3.5 w-3.5" /></Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Sync history" />
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr><Th>Started</Th><Th>Trigger</Th><Th>Status</Th><Th className="text-right">New</Th><Th className="text-right">Updated</Th><Th className="text-right">Unchanged</Th><Th className="text-right">Duplicates</Th><Th className="text-right">Errors</Th></tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(h.started_at)}</Td>
                  <Td className="text-xs capitalize">{h.trigger_type.replace("_", " ")}</Td>
                  <Td><Badge tone={statusTone(h.status)}>{h.status}</Badge></Td>
                  <Td className="text-right tabular-nums">{h.new_count}</Td>
                  <Td className="text-right tabular-nums">{h.updated_count}</Td>
                  <Td className="text-right tabular-nums">{h.unchanged_count}</Td>
                  <Td className="text-right tabular-nums">{h.duplicate_count}</Td>
                  <Td className="text-right tabular-nums">{h.error_count}</Td>
                </tr>
              ))}
              {history.data?.length === 0 && <tr><td colSpan={8}><EmptyState title="No syncs yet" description="Press “Sync now” to load your Google Sheets." /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && <EditTab tab={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TabToggle({ tab }: { tab: SheetTab }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: boolean) => api.put(`/google-sheets/tabs/${tab.id}`, { is_enabled: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sheets"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });
  return <Switch checked={tab.is_enabled} disabled={m.isPending || tab.data_kind === "ignore"} onChange={(v) => m.mutate(v)} />;
}

function EditTab({ tab, onClose }: { tab: SheetTab; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({
    data_kind: tab.data_kind,
    department_code: tab.department_code ?? "",
    sub_department: tab.sub_department ?? "",
    sheet_gid: tab.sheet_gid?.toString() ?? "",
    mapping: JSON.stringify(tab.mapping ?? {}, null, 2),
  });
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: object) => api.put(`/google-sheets/tabs/${tab.id}`, body),
    onSuccess: () => {
      toast.success("Mapping saved. It applies on the next sync.");
      qc.invalidateQueries({ queryKey: ["sheets"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const save = () => {
    let mapping: object;
    try {
      mapping = JSON.parse(form.mapping || "{}");
    } catch {
      setJsonError("Mapping is not valid JSON.");
      return;
    }
    m.mutate({
      data_kind: form.data_kind,
      department_code: form.department_code || null,
      sub_department: form.sub_department || null,
      sheet_gid: form.sheet_gid === "" ? null : Number(form.sheet_gid),
      mapping,
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Mapping: ${tab.tab_name}`}
      description="Tab name never decides permissions. The department chosen here does."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={m.isPending}>Save mapping</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Data in this tab</Label>
          <Select value={form.data_kind} onChange={(e) => setForm({ ...form, data_kind: e.target.value as SheetTab["data_kind"] })}>
            <option value="doctors">Doctors</option><option value="feedback">Patient feedback</option><option value="ignore">Not synced</option>
          </Select>
        </div>
        <div>
          <Label>Department</Label>
          <Select value={form.department_code} onChange={(e) => setForm({ ...form, department_code: e.target.value })}>
            <option value="">—</option><option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option>
          </Select>
        </div>
        <div>
          <Label>Sub-department (default)</Label>
          <Input value={form.sub_department} placeholder="e.g. Geneticist, Oncology" onChange={(e) => setForm({ ...form, sub_department: e.target.value })} />
        </div>
        <div>
          <Label>Sheet gid (for public-link reading)</Label>
          <Input value={form.sheet_gid} inputMode="numeric" onChange={(e) => setForm({ ...form, sheet_gid: e.target.value.replace(/\D/g, "") })} />
        </div>
        <div className="col-span-2">
          <Label>Advanced mapping (JSON)</Label>
          <Textarea rows={10} className="font-mono text-xs" value={form.mapping} onChange={(e) => { setJsonError(null); setForm({ ...form, mapping: e.target.value }); }} />
          {jsonError && <p className="mt-1 text-xs text-red-700">{jsonError}</p>}
          <p className="mt-1 text-[11px] text-ink-soft">
            Columns: {tab.headers.join(", ") || "read on next sync"}. Unknown columns are kept automatically. See GOOGLE_SHEETS.md for the format.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
