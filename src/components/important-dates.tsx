"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Cake, CalendarDays, CalendarRange, Mail, MessageCircle, PartyPopper, Search, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, Skeleton, StatCard, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { ImportantDate } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDateTime, formatDayMonth, whatsappLink } from "@/lib/utils";

type Kind = "birthday" | "anniversary";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const COPY: Record<Kind, {
  title: string; description: string; noun: string; plural: string; icon: typeof Cake;
  accent: string; chip: string; wish: (name: string) => string; subject: string; years: (n: number) => string;
}> = {
  birthday: {
    title: "Birthdays",
    description: "Every doctor's birthday, soonest first. Wish them by email or WhatsApp straight from here.",
    noun: "birthday", plural: "birthdays", icon: Cake,
    accent: "text-pink-600", chip: "bg-pink-50 text-pink-700 ring-pink-200",
    subject: "Happy Birthday!",
    wish: (n) => `Dear ${n},\n\nWishing you a very Happy Birthday! May the year ahead bring you good health, happiness and success.\n\nWarm regards,\nIKRIS Pharma Network`,
    years: (n) => `Turns ${n}`,
  },
  anniversary: {
    title: "Work Anniversaries",
    description: "Every doctor's work anniversary, soonest first. Congratulate them by email or WhatsApp straight from here.",
    noun: "work anniversary", plural: "work anniversaries", icon: Briefcase,
    accent: "text-indigo-600", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    subject: "Happy Work Anniversary!",
    wish: (n) => `Dear ${n},\n\nCongratulations on your work anniversary! Thank you for your dedication to patient care. Wishing you many more years of success.\n\nWarm regards,\nIKRIS Pharma Network`,
    years: (n) => `${n} year${n === 1 ? "" : "s"}`,
  },
};

function greetName(name: string): string {
  const n = name.trim();
  return /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`;
}

function whenLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 31) return `In ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? "" : "s"}`;
  return `In ${Math.round(days / 30.4)} month${Math.round(days / 30.4) === 1 ? "" : "s"}`;
}

function yearsOn(d: ImportantDate): number | null {
  return d.year ? Number(d.next_date.slice(0, 4)) - d.year : null;
}

/** Wish sent for this occurrence: within 3 days before the date, or after it. */
function wishedThisTime(d: ImportantDate): boolean {
  if (!d.last_wish_at) return false;
  const prev = new Date(`${d.next_date}T00:00:00+05:30`);
  if (d.days_until > 0) prev.setFullYear(prev.getFullYear() - 1);
  return new Date(d.last_wish_at).getTime() >= prev.getTime() - 3 * 86400000;
}

function WishButtons({ d, kind, compact }: { d: ImportantDate; kind: Kind; compact?: boolean }) {
  const c = COPY[kind];
  const text = c.wish(greetName(d.doctor_name));
  const wa = whatsappLink(d.contact_number);
  const btn = compact
    ? "rounded p-1.5 text-ink-soft hover:bg-slate-100 hover:text-brand-800"
    : "inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink hover:bg-slate-50";
  return (
    <div className="flex items-center gap-1.5">
      {d.email && (
        <a className={btn} aria-label="Send email wish" title={`Email ${d.email}`}
          href={`mailto:${d.email}?subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(text)}`}>
          <Mail className="h-4 w-4" />{!compact && "Email"}
        </a>
      )}
      {wa && (
        <a className={btn} aria-label="Send WhatsApp wish" title={`WhatsApp ${d.contact_number}`}
          href={`${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          <MessageCircle className="h-4 w-4" />{!compact && "WhatsApp"}
        </a>
      )}
      {!d.email && !wa && <span className="text-[11px] text-ink-soft">No email or phone</span>}
    </div>
  );
}

export function ImportantDatesPage({ kind }: { kind: Kind }) {
  const c = COPY[kind];
  const Icon = c.icon;
  const { me } = useAuth();
  const [q, setQ] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [month, setMonth] = React.useState("");
  const [view, setView] = React.useState<"upcoming" | "months">("upcoming");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["important-dates", kind],
    queryFn: () => api.get<{ items: ImportantDate[] }>("/calendar/people", { kind }),
  });
  const all = data?.items ?? [];

  const filtered = all.filter((d) => {
    if (dept && d.department !== dept) return false;
    if (month && Number(d.original.slice(5, 7)) !== Number(month)) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![d.doctor_name, d.institute, d.sub_department, d.email].some((v) => v?.toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(5, 7);
  const today = all.filter((d) => d.days_until === 0);
  const week = all.filter((d) => d.days_until <= 7);
  const inMonth = all.filter((d) => d.original.slice(5, 7) === thisMonth);
  const showDept = me?.role === "ADMIN";

  const byMonth = React.useMemo(() => {
    const groups: ImportantDate[][] = Array.from({ length: 12 }, () => []);
    filtered.forEach((d) => groups[Number(d.original.slice(5, 7)) - 1].push(d));
    groups.forEach((g) => g.sort((a, b) => a.original.slice(8).localeCompare(b.original.slice(8)) || a.doctor_name.localeCompare(b.doctor_name)));
    return groups;
  }, [filtered]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Icon className={cn("h-5 w-5", c.accent)} />{c.title}</span>}
        description={c.description}
        actions={
          <Link href="/calendar" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-slate-50">
            <CalendarDays className="h-4 w-4" /> Open calendar
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Doctors with a ${c.noun}`} value={isLoading ? "…" : all.length} icon={Icon} tone="brand" />
        <StatCard label="Today" value={isLoading ? "…" : today.length} icon={PartyPopper} tone="red" />
        <StatCard label="Next 7 days" value={isLoading ? "…" : week.length} icon={Sparkles} tone="amber" />
        <StatCard label={`In ${MONTHS[Number(thisMonth) - 1]}`} value={isLoading ? "…" : inMonth.length} icon={CalendarRange} tone="violet" />
      </div>

      {today.length > 0 && (
        <Card className="mb-5 overflow-hidden">
          <div className={cn("flex items-center gap-2 px-5 py-3 text-sm font-semibold ring-1 ring-inset", c.chip)}>
            <PartyPopper className="h-4 w-4" /> Today&apos;s {today.length === 1 ? c.noun : c.plural}
          </div>
          <ul className="divide-y divide-line">
            {today.map((d) => {
              const y = yearsOn(d);
              return (
                <li key={d.doctor_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/doctors/${d.doctor_id}`} className="font-medium text-ink hover:underline">{d.doctor_name}</Link>
                    <p className="text-xs text-ink-soft">
                      {[d.sub_department || DEPARTMENT_LABEL[d.department], d.institute, y ? c.years(y) : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {wishedThisTime(d) && <Badge tone="green">Wished {formatDateTime(d.last_wish_at)}</Badge>}
                  <WishButtons d={d} kind={kind} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctor, hospital, speciality…" className="pl-8" />
          </div>
          {showDept && (
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto" aria-label="Department">
              <option value="">All departments</option>
              <option value="NPP">NPP</option>
              <option value="RARE_DISEASES">Rare Diseases</option>
            </Select>
          )}
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto" aria-label="Month">
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
          <div className="flex rounded-md border border-line p-0.5 text-xs">
            {(["upcoming", "months"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={cn("rounded px-2.5 py-1.5 font-medium", view === v ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:text-ink")}>
                {v === "upcoming" ? "Upcoming" : "By month"}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : all.length === 0 ? (
          <EmptyState icon={Icon} title={`No ${c.plural} yet`}
            description={`Add a ${c.noun} column to the Birthday & Anniversary Google Sheet and run Sync, or open a doctor's profile and use Important dates → Edit.`} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="No matches" description="Try a different search, month or department." />
        ) : view === "upcoming" ? (
          <DatesTable rows={filtered} kind={kind} showDept={showDept} />
        ) : (
          <div className="divide-y divide-line">
            {byMonth.map((g, i) => g.length > 0 && (
              <div key={MONTHS[i]}>
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink">{MONTHS[i]}</p>
                  <span className="text-[11px] text-ink-soft">{g.length} {g.length === 1 ? c.noun : c.plural}</span>
                </div>
                <DatesTable rows={g} kind={kind} showDept={showDept} />
              </div>
            ))}
          </div>
        )}
      </Card>
      {!isLoading && filtered.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">Showing {filtered.length} of {all.length}. “Wished” comes from the automation log in the Google Sheet.</p>
      )}
    </div>
  );
}

function DatesTable({ rows, kind, showDept }: { rows: ImportantDate[]; kind: Kind; showDept: boolean }) {
  const c = COPY[kind];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            <Th>Doctor</Th>
            {showDept && <Th>Department</Th>}
            <Th>{kind === "birthday" ? "Birthday" : "Anniversary"}</Th>
            <Th>{kind === "birthday" ? "Age" : "Years"}</Th>
            <Th>Next</Th>
            <Th>Wish</Th>
            <Th className="text-right">Send</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((d) => {
            const y = yearsOn(d);
            const wished = wishedThisTime(d);
            return (
              <tr key={d.doctor_id} className={cn("hover:bg-slate-50/70", d.days_until === 0 && "bg-amber-50/40")}>
                <Td>
                  <Link href={`/doctors/${d.doctor_id}`} className="font-medium text-ink hover:underline">{d.doctor_name}</Link>
                  <p className="max-w-[280px] truncate text-[11px] text-ink-soft">{d.institute || d.email || "—"}</p>
                </Td>
                {showDept && (
                  <Td><Badge tone={departmentTone(d.department)}>{d.sub_department || DEPARTMENT_LABEL[d.department]}</Badge></Td>
                )}
                <Td className="whitespace-nowrap tabular-nums">{formatDayMonth(d.next_date)}{d.year ? <span className="text-ink-soft"> {d.year}</span> : null}</Td>
                <Td className="whitespace-nowrap text-ink-muted">{y ? c.years(y) : "—"}</Td>
                <Td className="whitespace-nowrap">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                    d.days_until === 0 ? "bg-red-50 text-red-700" : d.days_until <= 7 ? "bg-amber-50 text-amber-800" : "text-ink-muted")}>
                    {whenLabel(d.days_until)}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">
                  {wished ? <Badge tone="green">Sent</Badge>
                    : d.last_wish_at ? <span className="text-[11px] text-ink-soft">Last {formatDayMonth(d.last_wish_at.slice(0, 10))}</span>
                    : <span className="text-[11px] text-ink-soft">—</span>}
                </Td>
                <Td className="text-right"><div className="flex justify-end"><WishButtons d={d} kind={kind} compact /></div></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
