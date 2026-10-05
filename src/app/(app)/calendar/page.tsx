"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Cake, CalendarClock, ChevronLeft, ChevronRight, Mail, MessageCircle, MessageSquareHeart, Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { CalendarData, Department, ScheduleItem, UpcomingDate } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDayMonth, whatsappLink } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

type DayInfo = {
  people: CalendarData["dates"];
  outreach: CalendarData["outreach"];
  feedback: CalendarData["feedback"];
  schedule: CalendarData["schedule"];
};

export default function CalendarPage() {
  const { me } = useAuth();
  const today = todayIST();
  const [month, setMonth] = React.useState(today.slice(0, 7));
  const [selected, setSelected] = React.useState(today);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);

  const cal = useQuery({ queryKey: ["calendar", month], queryFn: () => api.get<CalendarData>("/calendar", { month }) });
  const upcoming = useQuery({
    queryKey: ["upcoming-dates"],
    queryFn: () => api.get<{ items: UpcomingDate[]; with_dob: number; with_anniversary: number }>("/calendar/upcoming", { days: 30 }),
  });

  const byDay = React.useMemo(() => {
    const map: Record<string, DayInfo> = {};
    const get = (d: string) => (map[d] ||= { people: [], outreach: [], feedback: [], schedule: [] });
    cal.data?.dates.forEach((x) => get(x.date).people.push(x));
    cal.data?.outreach.forEach((x) => get(x.date).outreach.push(x));
    cal.data?.feedback.forEach((x) => get(x.date).feedback.push(x));
    cal.data?.schedule.forEach((x) => get(x.date).schedule.push(x));
    return map;
  }, [cal.data]);

  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);

  const day = byDay[selected];
  const noDates = upcoming.data && upcoming.data.with_dob === 0 && upcoming.data.with_anniversary === 0;

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Birthdays, work anniversaries, emails sent by the automations, patient feedback requests and scheduled automation runs, day by day."
        actions={me?.role === "ADMIN" && (
          <Button variant="outline" onClick={() => setScheduleOpen(true)}><Settings2 className="h-4 w-4" /> Automation schedule</Button>
        )}
      />

      {noDates && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Why no birthdays show yet</p>
          <p className="mt-1">
            None of the connected Google Sheets has a <b>Date of Birth</b> or <b>Date of Anniversary</b> column, so there are no dates to show.
            Two ways to add them:
          </p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Add columns named <b>Date of Birth</b> and <b>Date of Anniversary</b> to the doctor sheets (for example 15-Aug-1975, or just 15-Aug), then run Sync now. They are picked up automatically.</li>
            <li>Or open a doctor&apos;s profile and use <b>Important dates → Edit</b>. Dates entered there are kept across syncs.</li>
          </ol>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
              <h2 className="ml-2 text-sm font-semibold text-ink">{monthLabel(month)}</h2>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-ink-soft">
              <Legend icon={Cake} cls="text-pink-600" label="Birthday" />
              <Legend icon={Briefcase} cls="text-indigo-600" label="Work anniversary" />
              <Legend icon={Mail} cls="text-emerald-700" label="Emails sent" />
              <Legend icon={MessageSquareHeart} cls="text-sky-700" label="Feedback" />
              <Legend icon={CalendarClock} cls="text-violet-700" label="Scheduled" />
              <Button size="sm" variant="outline" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</Button>
            </div>
          </div>
          {cal.error ? (
            <div className="p-4"><ErrorState error={cal.error} onRetry={() => cal.refetch()} /></div>
          ) : (
            <div className="p-3">
              <div className="grid grid-cols-7 gap-1 pb-1">
                {WEEKDAYS.map((w) => <div key={w} className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{w}</div>)}
              </div>
              <div className={cn("grid grid-cols-7 gap-1", cal.isLoading && "opacity-50")}>
                {cells.map((d, i) => {
                  if (!d) return <div key={`x${i}`} className="min-h-[92px] rounded-md bg-slate-50/50" />;
                  const info = byDay[d];
                  const births = info?.people.filter((p) => p.kind === "birthday").length ?? 0;
                  const annivs = info?.people.filter((p) => p.kind === "anniversary").length ?? 0;
                  const sent = info?.outreach.filter((o) => o.status === "Sent").reduce((n, o) => n + o.count, 0) ?? 0;
                  const failed = info?.outreach.filter((o) => o.status === "Failed").reduce((n, o) => n + o.count, 0) ?? 0;
                  const fb = info?.feedback.reduce((n, o) => n + o.count, 0) ?? 0;
                  return (
                    <button key={d} onClick={() => setSelected(d)}
                      className={cn("flex min-h-[92px] flex-col items-stretch gap-0.5 rounded-md border p-1.5 text-left transition-colors",
                        selected === d ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-200" : "border-line hover:border-brand-200 hover:bg-slate-50")}>
                      <span className={cn("mb-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                        d === today ? "bg-brand-800 font-semibold text-white" : "text-ink")}>{Number(d.slice(8))}</span>
                      {births > 0 && <Chip icon={Cake} cls="bg-pink-50 text-pink-700" text={births === 1 ? info!.people.find((p) => p.kind === "birthday")!.doctor_name : `${births} birthdays`} />}
                      {annivs > 0 && <Chip icon={Briefcase} cls="bg-indigo-50 text-indigo-700" text={annivs === 1 ? info!.people.find((p) => p.kind === "anniversary")!.doctor_name : `${annivs} anniversaries`} />}
                      {info?.schedule.map((s) => <Chip key={s.name} icon={CalendarClock} cls="bg-violet-50 text-violet-700" text={s.name} />)}
                      {sent > 0 && <Chip icon={Mail} cls="bg-emerald-50 text-emerald-700" text={`${sent} sent${failed ? ` · ${failed} failed` : ""}`} />}
                      {sent === 0 && failed > 0 && <Chip icon={Mail} cls="bg-red-50 text-red-700" text={`${failed} failed`} />}
                      {fb > 0 && <Chip icon={MessageSquareHeart} cls="bg-sky-50 text-sky-700" text={`${fb} feedback`} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title={new Date(`${selected}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })} />
            <CardBody className="space-y-4">
              {!day ? (
                <p className="text-sm text-ink-soft">Nothing on this day.</p>
              ) : (
                <>
                  {day.people.length > 0 && (
                    <Section title="Birthdays & work anniversaries">
                      {day.people.map((p) => (
                        <Link key={`${p.kind}${p.doctor_id}`} href={`/doctors/${p.doctor_id}`} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                          {p.kind === "birthday" ? <Cake className="h-4 w-4 text-pink-600" /> : <Briefcase className="h-4 w-4 text-indigo-600" />}
                          <span className="flex-1 font-medium text-ink">{p.doctor_name}</span>
                          <Badge tone={departmentTone(p.department)}>{p.sub_department || DEPARTMENT_LABEL[p.department]}</Badge>
                        </Link>
                      ))}
                    </Section>
                  )}
                  {day.schedule.length > 0 && (
                    <Section title="Scheduled automations">
                      {day.schedule.map((s) => (
                        <div key={s.name} className="text-sm">
                          <p className="font-medium text-ink">{s.name} {s.time && <span className="text-xs font-normal text-ink-soft">at {s.time}</span>}</p>
                          {s.note && <p className="text-xs text-ink-soft">{s.note}</p>}
                        </div>
                      ))}
                    </Section>
                  )}
                  {day.outreach.length > 0 && (
                    <Section title="Emails from the automations">
                      {day.outreach.map((o) => (
                        <div key={`${o.campaign}${o.status}${o.department}`} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-ink">{o.campaign}</span>
                          <Badge tone={statusTone(o.status)}>{o.count} {o.status.toLowerCase()}</Badge>
                        </div>
                      ))}
                    </Section>
                  )}
                  {day.feedback.length > 0 && (
                    <Section title="Patient feedback requests">
                      {day.feedback.map((f) => (
                        <div key={`${f.status}${f.department}`} className="flex items-center justify-between text-sm">
                          <span className="text-ink">{DEPARTMENT_LABEL[f.department]}</span>
                          <Badge tone={statusTone(f.status)}>{f.count} {f.status.toLowerCase()}</Badge>
                        </div>
                      ))}
                    </Section>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <UpcomingCard kind="birthday" items={upcoming.data?.items} loading={upcoming.isLoading} />
          <UpcomingCard kind="anniversary" items={upcoming.data?.items} loading={upcoming.isLoading} />
        </div>
      </div>

      {scheduleOpen && <ScheduleDialog onClose={() => setScheduleOpen(false)} />}
    </div>
  );
}

function UpcomingCard({ kind, items, loading }: { kind: "birthday" | "anniversary"; items?: UpcomingDate[]; loading: boolean }) {
  const list = (items ?? []).filter((u) => u.kind === kind);
  const isB = kind === "birthday";
  const Icon = isB ? Cake : Briefcase;
  return (
    <Card>
      <CardHeader title={isB ? "Upcoming birthdays" : "Upcoming work anniversaries"} description="Next 30 days"
        action={<Link href={isB ? "/birthdays" : "/anniversaries"} className="text-xs font-medium text-brand-700 hover:underline">View all</Link>} />
      <CardBody className="p-0">
        {loading ? <div className="p-4"><Skeleton className="h-16" /></div> : list.length ? (
          <ul className="divide-y divide-line">
            {list.slice(0, 8).map((u) => {
              const wa = whatsappLink(u.contact_number);
              return (
                <li key={u.doctor_id} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className={cn("h-4 w-4 shrink-0", isB ? "text-pink-600" : "text-indigo-600")} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/doctors/${u.doctor_id}`} className="block truncate text-sm font-medium text-ink hover:underline">{u.doctor_name}</Link>
                    <p className="text-[11px] text-ink-soft">
                      {u.days_until === 0 ? "Today" : u.days_until === 1 ? "Tomorrow" : `In ${u.days_until} days`} · {formatDayMonth(u.next_date)}
                    </p>
                  </div>
                  {u.email && <a href={`mailto:${u.email}`} aria-label="Email" className="rounded p-1 text-ink-soft hover:bg-slate-100 hover:text-brand-800"><Mail className="h-4 w-4" /></a>}
                  {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="rounded p-1 text-ink-soft hover:bg-slate-100 hover:text-brand-800"><MessageCircle className="h-4 w-4" /></a>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-5 text-sm text-ink-soft">No {isB ? "birthdays" : "work anniversaries"} in the next 30 days.</p>
        )}
      </CardBody>
    </Card>
  );
}

function Legend({ icon: Icon, cls, label }: { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }) {
  return <span className="hidden items-center gap-1 lg:inline-flex"><Icon className={cn("h-3.5 w-3.5", cls)} />{label}</span>;
}

function Chip({ icon: Icon, cls, text }: { icon: React.ComponentType<{ className?: string }>; cls: string; text: string }) {
  return (
    <span className={cn("flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight", cls)} title={text}>
      <Icon className="h-3 w-3 shrink-0" /><span className="truncate">{text}</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["schedule"], queryFn: () => api.get<ScheduleItem[]>("/calendar/schedule") });
  const [rows, setRows] = React.useState<(ScheduleItem & { daysText: string })[] | null>(null);
  React.useEffect(() => {
    if (data && !rows) setRows(data.map((d) => ({ ...d, daysText: d.days.join(", ") })));
  }, [data, rows]);
  const save = useMutation({
    mutationFn: () => api.put("/calendar/schedule", (rows ?? []).map(({ daysText, ...r }) => ({
      ...r, days: daysText.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= 31),
    }))),
    onSuccess: () => {
      toast.success("Schedule saved");
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["schedule"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const set = (i: number, patch: Partial<ScheduleItem & { daysText: string }>) =>
    setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Automation schedule"
      description="When each Google Sheet automation runs. This only shows the runs on the calendar; the real timing is set by the Apps Script triggers."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || !rows}>Save</Button></>}>
      {!rows ? <Skeleton className="h-32" /> : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border border-line p-3">
              <div className="col-span-12 md:col-span-5"><Label>Name</Label><Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></div>
              <div className="col-span-5 md:col-span-3">
                <Label>Department</Label>
                <Select value={r.department} onChange={(e) => set(i, { department: e.target.value as Department })}>
                  <option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option>
                </Select>
              </div>
              <div className="col-span-3 md:col-span-2"><Label>Day(s)</Label><Input value={r.daysText} placeholder="1, 16" onChange={(e) => set(i, { daysText: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Label>Time</Label><Input value={r.time ?? ""} placeholder="09:00" onChange={(e) => set(i, { time: e.target.value })} /></div>
              <div className="col-span-1 flex justify-end">
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="col-span-12"><Input value={r.note ?? ""} placeholder="Note (optional)" onChange={(e) => set(i, { note: e.target.value })} /></div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", department: "NPP", days: [], daysText: "", time: "", note: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Add run
          </Button>
        </div>
      )}
    </Dialog>
  );
}
