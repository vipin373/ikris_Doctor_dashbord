"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Bell, Cake, Dna, HeartPulse, Mail, MessageCircle, MessageSquareHeart, Send, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCountUp } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton, StatCard } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";
import { number } from "@/lib/utils";
import type { RemindersData } from "@/components/reminders-shared";

// Brand chart palette: walnut, sage, amber and warm neutrals
const COLORS = ["#5A3E2B", "#87A96B", "#D5851F", "#9C7656", "#A9C493", "#E09A36", "#465C36", "#BE9B7B"];
const STATUS_COLORS: Record<string, string> = { Sent: "#6F9155", Failed: "#B5483D", "Not sent": "#D5851F", Duplicate: "#BE9B7B" };
const AXIS = { fontSize: 11, fill: "#776C5D" };
const AXIS_LABEL = { fontSize: 11, fill: "#473F35" };
const GRID = "#EFE7D8";
const TOOLTIP = {
  cursor: { fill: "rgba(135,169,107,0.10)" },
  contentStyle: { borderRadius: 12, border: "1px solid #E6DDCC", boxShadow: "0 16px 40px -12px rgba(41,37,31,0.28)", fontSize: 12, padding: "8px 12px" },
  labelStyle: { color: "#29251F", fontWeight: 600 },
};

const GRADIENTS = (
    <defs>
      <linearGradient id="g-sage" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#6F9155" /><stop offset="100%" stopColor="#A9C493" /></linearGradient>
      <linearGradient id="g-walnut" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#5A3E2B" /><stop offset="100%" stopColor="#9C7656" /></linearGradient>
      <linearGradient id="g-amber" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#C27318" /><stop offset="100%" stopColor="#EAAE57" /></linearGradient>
    </defs>
);

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Welcome hero with real figures only; decorative depth layers move gently. */
function WelcomeHero({ name, title, scope, data }: { name: string; title: string; scope: string; data?: DashboardSummary }) {
  const reach = data && data.total_doctors ? Math.round((data.contacted_doctors / data.total_doctors) * 100) : null;
  const shown = useCountUp(reach);
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <section className="relative mb-6 overflow-hidden rounded-[20px] border border-line/80 bg-gradient-to-br from-white via-white to-cream shadow-card">
      {/* depth layers */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 animate-float rounded-full bg-gradient-to-br from-sage-200/70 to-sage-400/20 blur-2xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 animate-float rounded-full bg-gradient-to-tr from-glow-200/60 to-transparent blur-2xl [animation-delay:-3s]" />
      <span aria-hidden className="pointer-events-none absolute right-[21rem] top-8 hidden h-16 w-16 rotate-12 rounded-[22px] border border-white/70 bg-gradient-to-br from-white/90 to-sage-100/60 shadow-lift xl:block animate-float [animation-delay:-1.5s]" />
      <span aria-hidden className="pointer-events-none absolute right-[25rem] top-20 hidden h-9 w-9 -rotate-6 rounded-xl bg-gradient-to-br from-glow-300 to-glow-600 shadow-glow xl:block animate-float [animation-delay:-4s]" />

      <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-end md:justify-between md:p-8">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sage-700">{today} · {title}</p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.025em] text-walnut-800 md:text-[30px]">
            {greeting()}, {name}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {data ? (
              <>
                You have <b className="font-semibold text-ink">{number(data.total_doctors)} doctors</b> in {scope}.{" "}
                <b className="font-semibold text-ink">{number(data.contacted_doctors)}</b> have been contacted, with{" "}
                <b className="font-semibold text-ink">{number(data.emails_sent)} emails</b> and{" "}
                <b className="font-semibold text-ink">{number(data.whatsapp_sent)} WhatsApp messages</b> sent so far.
              </>
            ) : "Loading your summary…"}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/reminders"><Button><Bell className="h-4 w-4" /> Open reminders</Button></Link>
            <Link href="/doctors"><Button variant="outline">View doctors <ArrowRight className="h-4 w-4" /></Button></Link>
          </div>
        </div>
        {reach !== null && (
          <div className="relative w-full rounded-2xl border border-white/80 bg-white/70 p-4 shadow-card backdrop-blur-sm md:w-72">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium text-ink-soft">Doctors reached</p>
              <p className="text-2xl font-bold tabular-nums tracking-[-0.03em] text-ink">{shown ?? reach}%</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream" role="progressbar" aria-valuenow={reach} aria-valuemin={0} aria-valuemax={100} aria-label="Doctors reached">
              <div className="h-full origin-left animate-grow rounded-full bg-gradient-to-r from-sage-600 via-sage-400 to-glow-400 shadow-[0_0_10px_rgba(135,169,107,0.6)]"
                style={{ width: `${reach}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-ink-soft">{number(data!.contacted_doctors)} of {number(data!.total_doctors)} doctors contacted at least once</p>
          </div>
        )}
      </div>
    </section>
  );
}

function RemindersStrip() {
  const { data } = useQuery({ queryKey: ["reminders"], queryFn: () => api.get<RemindersData>("/reminders") });
  if (!data) return null;
  const f = data.follow_ups;
  const overdue = f.filter((x) => x.bucket === "overdue").length;
  const soon = f.filter((x) => x.bucket === "today" || x.bucket === "week").length;
  const failed = f.filter((x) => x.failed?.length).length;
  const mols = data.new_molecules.filter((m) => (new Date(data.today).getTime() - new Date(m.approval_date).getTime()) / 86400000 <= 90);
  const items = [
    { n: overdue, text: "follow-up emails overdue", tone: "text-red-700 bg-red-50 border-red-200", show: overdue > 0 },
    { n: soon, text: "follow-ups due in the next 7 days", tone: "text-glow-800 bg-glow-50 border-glow-200", show: soon > 0 },
    { n: failed, text: "doctors with a failed email", tone: "text-red-700 bg-red-50 border-red-200", show: failed > 0 },
    { n: data.important_dates.length, text: "birthdays / anniversaries this week", tone: "text-walnut-700 bg-walnut-50 border-walnut-200", show: data.important_dates.length > 0 },
    { n: mols.length, text: "new FDA molecules (not approved in India)", tone: "text-sage-800 bg-sage-50 border-sage-200", show: mols.length > 0 },
  ].filter((i) => i.show);
  if (!items.length) return null;
  return (
    <Link href="/reminders" className="group mb-6 flex flex-wrap items-center gap-2 rounded-card border border-line/80 bg-white/90 px-4 py-3 shadow-card transition-[box-shadow,border-color,transform] duration-350 ease-smooth hover:-translate-y-0.5 hover:border-glow-200 hover:shadow-lift">
      <span className="mr-1 inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="rounded-lg bg-glow-50 p-1.5 text-glow-600 ring-1 ring-inset ring-glow-200"><Bell className="h-3.5 w-3.5" /></span> Reminders
      </span>
      {items.map((i) => (
        <span key={i.text} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${i.tone}`}><b>{number(i.n)}</b> {i.text}</span>
      ))}
      <span className="ml-auto text-xs font-semibold text-sage-700 transition-transform duration-250 group-hover:translate-x-0.5">Open reminders →</span>
    </Link>
  );
}

export default function DashboardPage() {
  const { me } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
  });

  const title = me?.role === "NPP" ? "NPP Dashboard" : me?.role === "RARE_DISEASES" ? "Rare Disease Dashboard" : "Dashboard";
  const sub = (name: string) => data?.by_sub_department.find((s) => s.name === name)?.count ?? 0;
  const outreach = React.useMemo(() => {
    const map: Record<string, Record<string, number | string>> = {};
    (data?.outreach_by_campaign ?? []).forEach((r) => {
      // one bar for all FDA drug messages instead of one per drug
      const name = r.campaign.startsWith("FDA") ? "FDA drug messages" : r.campaign;
      map[name] ||= { campaign: name, total: 0 };
      map[name][r.status] = ((map[name][r.status] as number) || 0) + r.count;
      map[name].total = (map[name].total as number) + r.count;
    });
    return Object.values(map).sort((a, b) => (b.total as number) - (a.total as number));
  }, [data]);
  const statuses = Array.from(new Set((data?.outreach_by_campaign ?? []).map((r) => r.status)));
  const categoriesSet = (data?.by_category ?? []).some((c) => c.category !== "Not set");
  const feedback = Object.entries(data?.feedback_by_status ?? {}).map(([name, value]) => ({ name, value }));
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <WelcomeHero name={(me?.name || me?.email || "").split(/[\s@]/)[0] || "there"} title={title} data={data}
        scope={me?.role === "ADMIN" ? "all departments (NPP and Rare Diseases)" : "your department"} />
      <RemindersStrip />
      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data.total_doctors === 0 ? (
        <Card>
          <EmptyState
            icon={Stethoscope}
            title="No doctors yet"
            description={me?.role === "ADMIN" ? "Run the first Google Sheets sync to load your doctor lists." : "Doctors appear here after an administrator syncs the Google Sheets."}
            action={me?.role === "ADMIN" ? <Link href="/google-sheets" className="text-sm font-medium text-brand-700 hover:underline">Open Google Sheets Sync Center →</Link> : undefined}
          />
        </Card>
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total doctors" value={number(data.total_doctors)} icon={Users}
              hint={`${number(data.with_email)} with valid email · ${number(data.with_phone)} with phone`} />
            {me?.departments.includes("NPP") && (
              <StatCard label="NPP doctors" value={number(data.by_department.NPP)} icon={HeartPulse} tone="sky"
                hint={`Oncology ${number(sub("Oncology"))} · Hematology ${number(sub("Hematology"))}`} />
            )}
            {me?.departments.includes("RARE_DISEASES") && (
              <StatCard label="Rare Disease doctors" value={number(data.by_department.RARE_DISEASES)} icon={Dna} tone="violet"
                hint={data.by_sub_department.filter((s) => s.department === "RARE_DISEASES").map((s) => `${s.name} ${s.count}`).join(" · ")} />
            )}
            <StatCard label="Emails sent" value={number(data.emails_sent)} icon={Send} tone="green"
              hint={`${number(data.contacted_doctors)} doctors contacted · ${number(data.emails_failed)} failed`} />
            <StatCard label="WhatsApp messages" value={number(data.whatsapp_sent)} icon={MessageCircle} tone="amber" hint="From the sheets and the FDA module" />
            <StatCard label="Replies received" value={number(data.replies)} icon={Mail} hint="Reply tracking starts in phase 2" />
            <StatCard label="Patient feedback requests" value={number(data.feedback_total)} icon={MessageSquareHeart} tone="sky"
              hint={feedback.map((f) => `${f.name} ${f.value}`).join(" · ")} />
            <Link href="/calendar" className="block rounded-card focus-visible:ring-2 focus-visible:ring-glow-400">
              <StatCard label="Upcoming birthdays (30 days)" value={number(data.upcoming_birthdays)} icon={Cake} tone="violet"
                hint={data.upcoming_birthdays ? "Open the calendar →" : "Add birthdays: see Calendar & Birthdays →"} />
            </Link>
          </div>

          <div className="stagger mt-6 grid gap-4 xl:grid-cols-2">
            <Card interactive tilt={1}>
              <CardHeader title="Doctors by sub-department" description="Department → Oncology, Hematology, Rare Disease specialties" />
              <CardBody className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.by_sub_department} layout="vertical" margin={{ left: 16, right: 16 }}>
                    {GRADIENTS}
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" tick={AXIS} />
                    <YAxis type="category" dataKey="name" width={150} interval={0} tick={AXIS_LABEL} />
                    <Tooltip {...TOOLTIP} />
                    <Bar dataKey="count" name="Doctors" radius={[0, 6, 6, 0]} maxBarSize={18} animationDuration={900} animationEasing="ease-out">
                      {data.by_sub_department.map((s, i) => (
                        <Cell key={i} fill={s.department === "RARE_DISEASES" ? "url(#g-walnut)" : "url(#g-sage)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card interactive tilt={1}>
              <CardHeader title="Outreach by campaign" description="Emails from the sheet automations and FDA drug messages (WhatsApp + email)" />
              <CardBody style={{ height: Math.max(220, outreach.length * 34 + 70) }}>
                {outreach.length === 0 ? (
                  <EmptyState title="No outreach recorded yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outreach} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barCategoryGap={6}>
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" tick={AXIS} allowDecimals={false} />
                      <YAxis type="category" dataKey="campaign" width={170} interval={0}
                        tick={AXIS_LABEL}
                        tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
                      <Tooltip {...TOOLTIP} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {statuses.map((s, i) => (
                        <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s] ?? COLORS[i]} maxBarSize={20} animationDuration={900} animationEasing="ease-out" />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
            <LocationChart cities={data.top_cities} states={data.top_states ?? []} />
            <Card interactive tilt={1}>
              <CardHeader title={categoriesSet ? "Category A / B / C" : "Patient feedback status"}
                description={categoriesSet ? undefined : "Category A/B/C appears once the master sheets with a Category column are connected"} />
              <CardBody className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoriesSet ? data.by_category.map((c) => ({ name: c.category === "Not set" ? c.category : `Category ${c.category}`, value: c.count })) : feedback}
                      dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3} cornerRadius={6} stroke="#fff" strokeWidth={2} animationDuration={900}
                    >
                      {(categoriesSet ? data.by_category : feedback).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>

          {data.data_issue_doctors > 0 && (
            <Link href="/doctors?data_issue=any" className="mt-6 flex items-center gap-3 rounded-card border border-glow-200 bg-glow-50 px-4 py-3 text-sm text-glow-900 transition-colors hover:bg-glow-100">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <b>{number(data.data_issue_doctors)} doctors</b> have data issues in the source sheets (invalid emails, phone numbers stored as 9.9E+09, possible duplicates). Review them →
              </span>
            </Link>
          )}
        </>
      )}
    </div>
  );
}


/** Top cities, or top states (the Rare Diseases sheet has State but no City). */
function LocationChart({ cities, states }: { cities: { city: string; count: number }[]; states: { state: string; count: number }[] }) {
  const [view, setView] = React.useState<"city" | "state" | null>(null);
  const mode = view ?? (cities.length ? "city" : "state");
  const rows = mode === "city" ? cities.map((c) => ({ name: c.city, count: c.count })) : states.map((s) => ({ name: s.state, count: s.count }));
  const tabs = (
    <div className="flex rounded-lg border border-line bg-cream/50 p-0.5 text-xs" role="tablist">
      {(["city", "state"] as const).map((m) => (
        <button key={m} onClick={() => setView(m)} role="tab" aria-selected={mode === m}
          className={cn("rounded-md px-2.5 py-1 transition-all duration-250", mode === m ? "bg-white font-semibold text-sage-800 shadow-card" : "text-ink-soft hover:text-ink")}>
          {m === "city" ? "Cities" : "States"}
        </button>
      ))}
    </div>
  );
  return (
    <Card interactive tilt={1}>
      <CardHeader title={mode === "city" ? "Top cities" : "Top states"} action={tabs} />
      <CardBody className="h-64">
        {rows.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
              {GRADIENTS}
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" allowDecimals={false} tick={AXIS} />
              <YAxis type="category" dataKey="name" width={110} interval={0} tick={AXIS_LABEL} />
              <Tooltip {...TOOLTIP} />
              <Bar dataKey="count" name="Doctors" fill="url(#g-amber)" radius={[0, 6, 6, 0]} maxBarSize={18} animationDuration={900} animationEasing="ease-out" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState title={mode === "city" ? "No cities in the sheets" : "No states in the sheets"}
            description={`Add a ${mode === "city" ? "City" : "State"} column to the Google Sheet and sync to see this chart.`} />
        )}
      </CardBody>
    </Card>
  );
}
