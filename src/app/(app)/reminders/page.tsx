"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Cake, CalendarClock, Download, Heart, Mail, Pill, Search, Send, Settings2, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { AREA_LABEL, AREA_TONE, fdaDate } from "@/lib/fda";
import { cn, DEPARTMENT_LABEL, number } from "@/lib/utils";
import { daysAgo, MoleculeList, type RemindersData } from "@/components/reminders-shared";

const BUCKETS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "week", label: "Next 7 days" },
  { id: "later", label: "Later" },
  { id: "failed", label: "Failed emails" },
  { id: "all", label: "All" },
] as const;

export default function RemindersPage() {
  const { me } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["reminders"], queryFn: () => api.get<RemindersData>("/reminders") });
  const [bucket, setBucket] = React.useState<string>("overdue");
  const [dept, setDept] = React.useState("");
  const [q, setQ] = React.useState("");
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const f = data?.follow_ups ?? [];
  const count = (b: string) => f.filter((x) => x.bucket === b).length;
  const rows = f.filter((x) => (bucket === "all" || x.bucket === bucket) && (!dept || x.department === dept)
    && (!q || `${x.doctor_name} ${x.institute ?? ""} ${x.email ?? ""} ${x.sub_department ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const recentMolecules = (data?.new_molecules ?? []).filter((m) => (daysAgo(data!.today, m.approval_date) ?? 999) <= 90);

  const exportCsv = () => {
    const cols = ["doctor_name", "department", "sub_department", "institute", "email", "last_campaign", "last_sent_at", "due_date", "days_overdue", "pending", "failed"] as const;
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(Array.isArray(r[c]) ? (r[c] as string[]).join("; ") : r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `follow-ups-${bucket}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Bell className="h-5 w-5 text-brand-700" />Reminders</span>}
        description={`Who needs the next email, failed emails to fix, upcoming birthdays and new FDA molecules. A follow-up is due ${data?.settings.npp_days ?? 20} days after the last email for NPP and ${data?.settings.rare_days ?? 15} days for Rare Diseases (or the doctor's own contact frequency).`}
        actions={me?.role === "ADMIN" && <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /> Reminder rules</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Follow-up overdue" value={isLoading ? "…" : number(count("overdue"))} icon={AlertTriangle} tone="red" />
        <StatCard label="Due today / next 7 days" value={isLoading ? "…" : `${number(count("today"))} / ${number(count("week"))}`} icon={CalendarClock} tone="amber" />
        <StatCard label="Failed emails" value={isLoading ? "…" : number(count("failed") + f.filter((x) => x.bucket !== "failed" && x.failed?.length).length)} icon={Mail} tone="red" />
        <StatCard label="Birthdays & anniversaries (7 days)" value={isLoading ? "…" : number(data?.important_dates.length)} icon={Cake} tone="violet" />
        <StatCard label="FDA: eligible again" value={isLoading ? "…" : number(data?.fda_eligible.length)} icon={Send} tone="sky" />
        <StatCard label="New FDA molecules (90 days)" value={isLoading ? "…" : number(recentMolecules.length)} icon={Sparkles} tone="green" hint="Not approved in India" />
      </div>

      {recentMolecules.length > 0 && (
        <Card className="mb-5 border-emerald-200">
          <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-900">
            <Sparkles className="h-4 w-4" /> New FDA molecules not approved in India
            <Link href="/fda?tab=drugs" className="ml-auto text-xs font-medium text-emerald-800 underline">Open FDA</Link>
          </div>
          <MoleculeList items={recentMolecules.slice(0, 8)} today={data!.today} />
        </Card>
      )}

      <Card className="mb-5">
        <CardHeader title="Next email due" description="Doctors whose follow-up email is due, based on the last email sent from the Google Sheet automations or the FDA module." />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap gap-1 text-xs">
            {BUCKETS.map((b) => (
              <button key={b.id} onClick={() => setBucket(b.id)}
                className={cn("rounded-full border px-2.5 py-1", bucket === b.id ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line text-ink-muted hover:text-ink")}>
                {b.label}{b.id !== "all" && ` (${count(b.id)})`}
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[180px] flex-1 md:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctor, hospital…" className="pl-8" />
          </div>
          {me?.role === "ADMIN" && (
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto" aria-label="Department">
              <option value="">All departments</option><option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option>
            </Select>
          )}
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export</Button>
        </div>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !rows.length ? (
          <EmptyState icon={Bell} title="Nothing here" description="No doctors in this group." />
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Doctor</Th><Th>Department</Th><Th>Last email</Th><Th>Next email due</Th><Th>Pending in sheet</Th><Th className="text-right">Action</Th></tr></thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.doctor_id} className="hover:bg-slate-50/70">
                    <Td>
                      <Link href={`/doctors/${r.doctor_id}`} className="font-medium text-ink hover:underline">
                        {r.must_see && <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" />}{r.doctor_name}
                      </Link>
                      <p className="max-w-[240px] truncate text-[11px] text-ink-soft">{r.institute || r.email}</p>
                    </Td>
                    <Td><Badge tone={departmentTone(r.department)}>{r.sub_department || DEPARTMENT_LABEL[r.department]}</Badge></Td>
                    <Td className="text-xs">
                      {r.last_sent_at ? <>{r.last_campaign}<p className="text-ink-soft">{fdaDate(r.last_sent_at)}</p></> : <span className="text-ink-soft">No email delivered yet</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {r.due_date ? <>
                        {fdaDate(r.due_date)}
                        <p className={cn("font-medium", r.bucket === "overdue" ? "text-red-700" : r.bucket === "today" ? "text-amber-700" : "text-ink-soft")}>
                          {r.bucket === "overdue" ? `${r.days_overdue} day${r.days_overdue === 1 ? "" : "s"} overdue` : r.bucket === "today" ? "Due today" : `In ${-(r.days_overdue ?? 0)} days`}
                        </p>
                      </> : "—"}
                    </Td>
                    <Td className="max-w-[240px] text-[11px]">
                      {r.pending?.map((p) => <p key={p} className="text-amber-800">{p}: not sent yet</p>)}
                      {r.failed?.map((p) => <p key={p} className="text-red-700">{p}: failed</p>)}
                      {!r.pending && !r.failed && <span className="text-ink-soft">—</span>}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.email && <a href={`mailto:${r.email}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-xs hover:bg-slate-50" title={r.email}><Mail className="h-3.5 w-3.5" />Email</a>}
                        <Link href="/fda?tab=single" className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-xs hover:bg-slate-50"><Pill className="h-3.5 w-3.5" />FDA msg</Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <p className="px-4 py-2 text-xs text-ink-soft">Showing 500 of {rows.length}. Export to see all.</p>}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Birthdays & work anniversaries — next 7 days" action={<Link href="/birthdays" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>} />
          {!data?.important_dates.length ? <p className="px-5 py-5 text-sm text-ink-soft">None in the next 7 days.</p> : (
            <ul className="divide-y divide-line">
              {data.important_dates.map((d) => (
                <li key={d.kind + d.doctor_id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {d.kind === "birthday" ? <Cake className="h-4 w-4 text-pink-600" /> : <Heart className="h-4 w-4 text-indigo-600" />}
                  <Link href={`/doctors/${d.doctor_id}`} className="flex-1 font-medium text-ink hover:underline">{d.doctor_name}</Link>
                  <span className="text-xs text-ink-soft">{d.days_until === 0 ? "Today" : d.days_until === 1 ? "Tomorrow" : `In ${d.days_until} days`} · {fdaDate(d.next_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="FDA messages: doctors eligible again" description="Their contact-frequency window has passed or ends this week." />
          {!data?.fda_eligible.length ? <p className="px-5 py-5 text-sm text-ink-soft">No doctor has received an FDA message yet.</p> : (
            <ul className="divide-y divide-line">
              {data.fda_eligible.slice(0, 20).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {d.must_see && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                  <Link href={`/doctors/${d.id}`} className="flex-1 font-medium text-ink hover:underline">{d.doctor_name}</Link>
                  <span className="text-xs text-ink-soft">Last FDA message {fdaDate(d.last_message_sent_at)}{d.next_eligible_at ? ` · eligible ${fdaDate(d.next_eligible_at)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {settingsOpen && data && <RuleDialog initial={data.settings} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function RuleDialog({ initial, onClose }: { initial: { npp_days: number; rare_days: number }; onClose: () => void }) {
  const qc = useQueryClient();
  const [npp, setNpp] = React.useState(initial.npp_days);
  const [rare, setRare] = React.useState(initial.rare_days);
  const save = useMutation({
    mutationFn: () => api.put("/reminders/settings", { npp_days: npp, rare_days: rare }),
    onSuccess: () => { toast.success("Reminder rules saved"); qc.invalidateQueries({ queryKey: ["reminders"] }); qc.invalidateQueries({ queryKey: ["calendar"] }); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Reminder rules"
      description="Days after the last email when the next email is due. A doctor's own contact frequency (set in FDA → doctor) overrides this."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>NPP (days)</Label><Input type="number" min={1} max={365} value={npp} onChange={(e) => setNpp(Number(e.target.value))} /></div>
        <div><Label>Rare Diseases (days)</Label><Input type="number" min={1} max={365} value={rare} onChange={(e) => setRare(Number(e.target.value))} /></div>
      </div>
    </Dialog>
  );
}
