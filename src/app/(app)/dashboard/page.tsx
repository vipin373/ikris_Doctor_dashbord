"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Cake, Dna, HeartPulse, Mail, MessageSquareHeart, Send, Stethoscope, Users } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";
import { number } from "@/lib/utils";

const COLORS = ["#172A5C", "#4C6FB5", "#8FA8D8", "#2F8F83", "#C08A2B", "#B04A5A", "#6E5BA8", "#7C8DA6"];
const STATUS_COLORS: Record<string, string> = { Sent: "#2F8F83", Failed: "#B04A5A", "Not sent": "#C08A2B", Duplicate: "#C08A2B" };

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
      <PageHeader
        title={title}
        description={me?.role === "ADMIN" ? "All departments: NPP and Rare Diseases." : "Figures cover your department only."}
      />
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            <StatCard label="WhatsApp messages" value={number(data.whatsapp_sent)} icon={Mail} hint="Sending starts in phase 2" />
            <StatCard label="Replies received" value={number(data.replies)} icon={Mail} hint="Reply tracking starts in phase 2" />
            <StatCard label="Patient feedback requests" value={number(data.feedback_total)} icon={MessageSquareHeart} tone="sky"
              hint={feedback.map((f) => `${f.name} ${f.value}`).join(" · ")} />
            <Link href="/calendar" className="block">
              <StatCard label="Upcoming birthdays (30 days)" value={number(data.upcoming_birthdays)} icon={Cake} tone="amber"
                hint={data.upcoming_birthdays ? "Open the calendar →" : "Add birthdays: see Calendar & Birthdays →"} />
            </Link>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Doctors by sub-department" description="Department → Oncology, Hematology, Rare Disease specialties" />
              <CardBody className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.by_sub_department} layout="vertical" margin={{ left: 16, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke="#EEF2F7" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: "#334155" }} />
                    <Tooltip cursor={{ fill: "#F1F5F9" }} />
                    <Bar dataKey="count" name="Doctors" radius={[0, 3, 3, 0]}>
                      {data.by_sub_department.map((s, i) => (
                        <Cell key={i} fill={s.department === "RARE_DISEASES" ? "#6E5BA8" : COLORS[i % 3]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Outreach by campaign" description="Emails from the sheet automations and FDA drug messages (WhatsApp + email)" />
              <CardBody style={{ height: Math.max(220, outreach.length * 34 + 70) }}>
                {outreach.length === 0 ? (
                  <EmptyState title="No outreach recorded yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={outreach} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barCategoryGap={6}>
                      <CartesianGrid horizontal={false} stroke="#EEF2F7" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} allowDecimals={false} />
                      <YAxis type="category" dataKey="campaign" width={170} interval={0}
                        tick={{ fontSize: 11, fill: "#334155" }}
                        tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
                      <Tooltip cursor={{ fill: "#F1F5F9" }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {statuses.map((s, i) => (
                        <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s] ?? COLORS[i]} maxBarSize={22} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top cities" />
              <CardBody className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.top_cities} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#EEF2F7" />
                    <XAxis dataKey="city" tick={{ fontSize: 11, fill: "#334155" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
                    <Tooltip cursor={{ fill: "#F1F5F9" }} />
                    <Bar dataKey="count" name="Doctors" fill="#4C6FB5" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={categoriesSet ? "Category A / B / C" : "Patient feedback status"}
                description={categoriesSet ? undefined : "Category A/B/C appears once the master sheets with a Category column are connected"} />
              <CardBody className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoriesSet ? data.by_category.map((c) => ({ name: c.category === "Not set" ? c.category : `Category ${c.category}`, value: c.count })) : feedback}
                      dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}
                    >
                      {(categoriesSet ? data.by_category : feedback).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>

          {data.data_issue_doctors > 0 && (
            <Link href="/doctors?data_issue=any" className="mt-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
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
