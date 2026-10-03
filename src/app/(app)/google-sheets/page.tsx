"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, Copy, ExternalLink, FileSpreadsheet, Link2, Loader2, Pencil, RefreshCw } from "lucide-react";
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

type Connections = {
  sources: SheetSource[];
  google_service_account: string | null;
  service_role_configured: boolean;
  scheduled_sync_available: boolean;
};

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
  const [editingSource, setEditingSource] = React.useState<SheetSource | null>(null);
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
          <Button onClick={() => sync.mutate()} disabled={sync.isPending || !conn.data}>
            {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync now
          </Button>
        }
      />

      {conn.data && !conn.data.scheduled_sync_available && (
        <div className="mb-4 rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink-muted">
          Use <b>Sync now</b> to refresh data. The automatic daily sync starts once <code>SUPABASE_SERVICE_ROLE_KEY</code> is added in Vercel → Settings → Environment Variables.
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

      {sources.some((src) => src.tabs.some((t) => t.data_kind === "templates")) && (
        <Card className="mb-5">
          <CardHeader title="Edit templates from the dashboard"
            description="Lets the Email Templates page write changes back into the Google Sheet. One-time setup per spreadsheet." />
          <div className="divide-y divide-line">
            {sources.filter((src) => src.tabs.some((t) => t.data_kind === "templates")).map((src) => (
              <div key={src.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-medium text-ink">{src.name}</p>
                  <p className="text-xs text-ink-soft">{src.tabs.filter((t) => t.data_kind === "templates").map((t) => t.tab_name).join(", ")}</p>
                </div>
                {src.write_bridge_url ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Connected</Badge> : <Badge tone="amber">Not connected</Badge>}
                <Button size="sm" variant={src.write_bridge_url ? "outline" : "primary"} onClick={() => setEditingSource(src)}>
                  <Link2 className="h-3.5 w-3.5" /> {src.write_bridge_url ? "Manage" : "Set up"}
                </Button>
              </div>
            ))}
          </div>
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
                  <Td><Badge tone={tab.data_kind === "doctors" ? "brand" : tab.data_kind === "feedback" ? "sky" : tab.data_kind === "templates" ? "violet" : "neutral"}>{tab.data_kind === "ignore" ? "Not synced" : tab.data_kind}</Badge></Td>
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
      {editingSource && <EditingSetup source={editingSource} onClose={() => setEditingSource(null)} />}
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
            <option value="doctors">Doctors</option><option value="feedback">Patient feedback</option><option value="templates">Email templates</option><option value="ignore">Not synced</option>
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

type EditingInfo = { connected: boolean; url: string | null; tabs: string[]; script: string };

function EditingSetup({ source, onClose }: { source: SheetSource; onClose: () => void }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["editing", source.id], queryFn: () => api.get<EditingInfo>(`/google-sheets/sources/${source.id}/editing`) });
  const [url, setUrl] = React.useState("");
  React.useEffect(() => { if (info.data?.url) setUrl(info.data.url); }, [info.data?.url]);
  const connect = useMutation({
    mutationFn: () => api.put<{ spreadsheet_name: string }>(`/google-sheets/sources/${source.id}/editing`, { url }),
    onSuccess: (r) => {
      toast.success(`Connected to “${r.spreadsheet_name}”. Templates can now be edited from the dashboard.`);
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Connection failed"),
  });
  const disconnect = useMutation({
    mutationFn: () => api.del(`/google-sheets/sources/${source.id}/editing`),
    onSuccess: () => { toast.success("Disconnected. Delete the web app deployment in Apps Script too."); qc.invalidateQueries(); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const copy = async () => {
    if (!info.data) return;
    await navigator.clipboard.writeText(info.data.script);
    toast.success("Script copied");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Edit templates from the dashboard: ${source.name}`}
      description="Adds a small Apps Script to this spreadsheet. It can change only the template tabs listed in it, and only with the secret token it contains."
      footer={<>
        {info.data?.connected && <Button variant="outline" className="mr-auto" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>}
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button onClick={() => connect.mutate()} disabled={connect.isPending || !url.trim()}>{connect.isPending ? "Testing…" : "Test and connect"}</Button>
      </>}>
      {info.isLoading ? <Skeleton className="h-40" /> : info.error ? <ErrorState error={info.error} /> : info.data && (
        <ol className="space-y-4 text-sm text-ink">
          <li>
            <p className="font-medium">1. Open the sheet&apos;s script editor</p>
            <p className="text-xs text-ink-soft">
              Open <a className="font-medium text-brand-700 underline" target="_blank" rel="noreferrer" href={`https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}/edit`}>{source.name}</a> → Extensions → Apps Script.
              Click <b>+</b> next to Files → Script, name it <code>IkrisDashboard</code>.
            </p>
          </li>
          <li>
            <div className="flex items-center justify-between">
              <p className="font-medium">2. Paste this code and press Save</p>
              <Button size="sm" variant="outline" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copy code</Button>
            </div>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-[10.5px] leading-relaxed text-slate-100">{info.data.script}</pre>
          </li>
          <li>
            <p className="font-medium">3. Deploy it as a web app</p>
            <p className="text-xs text-ink-soft">
              Deploy → New deployment → gear icon → <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Click Deploy and allow access when Google asks.
              Copy the <b>Web app URL</b> (it ends with <code>/exec</code>).
            </p>
          </li>
          <li>
            <p className="font-medium">4. Paste the Web app URL</p>
            <Input className="mt-1.5" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
          </li>
        </ol>
      )}
    </Dialog>
  );
}
