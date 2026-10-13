"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Download, ExternalLink, Mail, RefreshCw, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, Skeleton, StatCard, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, formatDateTime, number } from "@/lib/utils";

type NewDoctor = {
  id: number;
  sheet_row: number | null;
  doctor_name: string;
  specialty: string | null;
  sub_department: string | null;
  hospital: string | null;
  city: string | null;
  email: string | null;
  status: string | null;
  sent_at: string | null;
  sent_date_raw: string | null;
  subject_used: string | null;
  error: string | null;
  follow_up: string | null;
  thread_id: string | null;
  synced_at: string | null;
};
type Bucket = { name: string; count: number };
type Data = {
  items: NewDoctor[];
  summary: {
    total: number; with_email: number; sent: number; errors: number; follow_up_pending: number;
    by_specialty: Bucket[]; by_status: Bucket[]; by_follow_up: Bucket[]; by_department: Bucket[]; by_city: Bucket[];
    last_synced_at: string | null; sheet_url: string;
  };
};
type SyncResult = { rows: number; added: number; updated: number; removed: number; warnings: string[] };

const SPECIALTY_LABEL: Record<string, string> = { Onc: "Oncology", Hema: "Hematology" };
const spec = (s?: string | null) => (s ? SPECIALTY_LABEL[s] ?? s : "—");

export default function NewDoctorsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["new-doctors"], queryFn: () => api.get<Data>("/new-doctors") });
  const [q, setQ] = React.useState("");
  const [specialty, setSpecialty] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [city, setCity] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [followUp, setFollowUp] = React.useState("");

  const sync = useMutation({
    mutationFn: () => api.post<SyncResult>("/new-doctors/sync"),
    onSuccess: (r) => {
      toast.success(`Synced ${r.rows} doctors from the sheet (${r.added} new, ${r.removed} removed)`);
      r.warnings.slice(0, 3).forEach((w) => toast.warning(w));
      qc.invalidateQueries({ queryKey: ["new-doctors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const items = data?.items ?? [];
  const s = data?.summary;
  const notSet = (v: string | null) => v || "Not set";
  const rows = items.filter((r) =>
    (!specialty || notSet(r.specialty) === specialty) &&
    (!department || notSet(r.sub_department) === department) &&
    (!city || notSet(r.city) === city) &&
    (!status || notSet(r.status) === status) &&
    (!followUp || notSet(r.follow_up) === followUp) &&
    (!q || `${r.doctor_name} ${r.hospital ?? ""} ${r.email ?? ""} ${r.city ?? ""} ${r.subject_used ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  const exportCsv = () => {
    const cols = ["doctor_name", "specialty", "sub_department", "hospital", "city", "email", "status", "sent_date_raw", "subject_used", "error", "follow_up", "thread_id"] as const;
    const head = ["Doctor Name", "Specialty", "Department", "Hospital", "City", "Email", "Status", "Sent Date", "Subject Used", "Error", "Follow-up", "Thread ID"];
    const csv = [head.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "new-doctors.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const filter = (label: string, value: string, set: (v: string) => void, options?: Bucket[], fmt = (v: string) => v) => (
    <Select value={value} onChange={(e) => set(e.target.value)} className="w-auto" aria-label={label}>
      <option value="">{label}</option>
      {(options ?? []).map((o) => <option key={o.name} value={o.name}>{fmt(o.name)} ({o.count})</option>)}
    </Select>
  );

  return (
    <div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><UserPlus className="h-5 w-5 text-brand-700" />New Doctors</span>}
        description={<>New doctors found through Apollo, read only from the <a href={s?.sheet_url} target="_blank" rel="noreferrer" className="underline">IKRIS Doctor Mailer</a> sheet. This list is kept separate: it is not added to Doctors, NPP, Rare Diseases, Reminders, FDA or the dashboard counts.</>}
        actions={<>
          {s?.last_synced_at && <span className="text-xs text-ink-soft">Last synced {formatDateTime(s.last_synced_at)}</span>}
          <Button variant="outline" disabled={!rows.length} onClick={exportCsv}><Download className="h-4 w-4" /> Export</Button>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} /> {sync.isPending ? "Syncing…" : "Sync from sheet"}
          </Button>
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="New doctors" value={isLoading ? "…" : number(s?.total)} icon={Users} tone="brand"
          hint={s ? s.by_specialty.map((b) => `${spec(b.name)} ${b.count}`).join(" · ") : undefined} />
        <StatCard label="Email sent" value={isLoading ? "…" : number(s?.sent)} icon={Mail} tone="green" />
        <StatCard label="Follow-up pending" value={isLoading ? "…" : number(s?.follow_up_pending)} icon={Clock} tone="amber" />
        <StatCard label="Errors in sheet" value={isLoading ? "…" : number(s?.errors)} icon={AlertTriangle} tone="red" />
        <StatCard label="Cities" value={isLoading ? "…" : number(s?.by_city.filter((c) => c.name !== "Not set").length)} icon={ExternalLink} tone="sky"
          hint={s?.by_city.slice(0, 3).map((c) => `${c.name} ${c.count}`).join(" · ")} />
      </div>

      <Card>
        <CardHeader title="Apollo doctor list" description={`${number(rows.length)} of ${number(items.length)} shown, newest email first.`} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[200px] flex-1 md:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctor, hospital, email…" className="pl-8" />
          </div>
          {filter("All specialties", specialty, setSpecialty, s?.by_specialty, spec)}
          {filter("All departments", department, setDepartment, s?.by_department)}
          {filter("All cities", city, setCity, s?.by_city)}
          {filter("All statuses", status, setStatus, s?.by_status)}
          {filter("All follow-ups", followUp, setFollowUp, s?.by_follow_up)}
        </div>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !items.length ? (
          <EmptyState icon={UserPlus} title="No new doctors yet" description="Click 'Sync from sheet' to load the Apollo doctor list." />
        ) : !rows.length ? (
          <EmptyState icon={Search} title="No matches" description="No doctors match these filters." />
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Doctor</Th><Th>Specialty</Th><Th>Hospital</Th><Th>Email</Th><Th>Status</Th><Th>Sent</Th><Th>Subject used</Th><Th>Follow-up</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50/70">
                    <Td>
                      <p className="font-medium text-ink">{r.doctor_name}</p>
                      {r.sub_department && <p className="text-[11px] text-ink-soft">{r.sub_department}</p>}
                    </Td>
                    <Td><Badge tone={r.specialty === "Hema" ? "violet" : "sky"}>{spec(r.specialty)}</Badge></Td>
                    <Td className="text-xs"><p className="max-w-[240px]">{r.hospital || "—"}</p><p className="text-ink-soft">{r.city}</p></Td>
                    <Td className="text-xs">{r.email ? <a href={`mailto:${r.email}`} className="text-brand-700 hover:underline">{r.email}</a> : <span className="text-ink-soft">—</span>}</Td>
                    <Td>
                      {r.status ? <Badge tone={statusTone(r.status)}>{r.status}</Badge> : <span className="text-xs text-ink-soft">—</span>}
                      {r.error && <p className="mt-1 max-w-[200px] text-[11px] text-red-700">{r.error}</p>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{r.sent_at ? formatDateTime(r.sent_at) : r.sent_date_raw || "—"}</Td>
                    <Td className="text-xs"><p className="max-w-[260px]">{r.subject_used || "—"}</p></Td>
                    <Td>{r.follow_up ? <Badge tone={statusTone(r.follow_up)}>{r.follow_up}</Badge> : <span className="text-xs text-ink-soft">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
