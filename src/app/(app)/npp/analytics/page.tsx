"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CATEGORY_KEYS, CATEGORY_META, type CategoryKey } from "@/components/npp/shared";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, Skeleton, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, number } from "@/lib/utils";

type Period = "all" | "today" | "yesterday" | "7d" | "30d" | "month" | "custom";
interface CurrentRow {
  doctors: number; email_sent?: number; email_delivered?: number; email_replies?: number; email_failed?: number;
  whatsapp_sent?: number; whatsapp_delivered?: number; whatsapp_replies?: number; whatsapp_failed?: number;
  contacted_doctors: number; engaged_doctors: number; email_reply_rate: number | null; whatsapp_reply_rate: number | null;
  email_delivery_rate: number | null; engagement_rate: number | null;
}
interface DistRow { name: string; A: number; B: number; C: number; UNASSIGNED: number; total: number }
interface Analytics {
  current: Record<CategoryKey, CurrentRow>;
  historical: { category_at_send: string; channel: string; sent: number; delivered: number; failed: number; total: number }[];
  distribution: Record<"state" | "city" | "specialty" | "hospital", DistRow[]>;
}

const PERIODS: [Period, string][] = [["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["custom", "Custom range"]];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
const TOOLTIP = { contentStyle: { borderRadius: 12, border: "1px solid #E6DDCC", fontSize: 12 }, cursor: { fill: "rgba(135,169,107,0.10)" } };

export default function CategoryAnalyticsPage() {
  const { me } = useAuth();
  const [period, setPeriod] = React.useState<Period>("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [dim, setDim] = React.useState<"state" | "city" | "specialty" | "hospital">("specialty");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["npp-analytics", period, from, to],
    queryFn: () => api.get<Analytics>("/npp/analytics", { period, date_from: period === "custom" ? from || undefined : undefined, date_to: period === "custom" ? to || undefined : undefined }),
    enabled: period !== "custom" || !!(from || to),
  });
  if (me && !me.departments.includes("NPP")) return <Card><EmptyState title="No access" description="Category analytics is for NPP." /></Card>;

  const rows = data ? CATEGORY_KEYS.map((k) => ({ key: k, label: CATEGORY_META[k].label, ...data.current[k] })) : [];
  const chart = rows.map((r) => ({ name: r.label, "Emails sent": r.email_sent ?? 0, "Email replies": r.email_replies ?? 0, "WhatsApp sent": r.whatsapp_sent ?? 0, "WhatsApp replies": r.whatsapp_replies ?? 0 }));

  const exportCsv = () => {
    if (!data) return;
    const head = ["Category", "Doctors", "Emails sent", "Emails delivered", "Email replies", "Email reply rate %", "Email delivery rate %", "Emails failed",
      "WhatsApp sent", "WhatsApp replies", "WhatsApp reply rate %", "WhatsApp failed", "Contacted doctors", "Engaged doctors", "Engagement rate %"];
    const lines = rows.map((r) => [r.label, r.doctors, r.email_sent ?? 0, r.email_delivered ?? 0, r.email_replies ?? 0, r.email_reply_rate ?? "", r.email_delivery_rate ?? "", r.email_failed ?? 0,
      r.whatsapp_sent ?? 0, r.whatsapp_replies ?? 0, r.whatsapp_reply_rate ?? "", r.whatsapp_failed ?? 0, r.contacted_doctors, r.engaged_doctors, r.engagement_rate ?? ""]);
    const dist = data.distribution[dim].map((d) => [d.name, d.A, d.B, d.C, d.UNASSIGNED, d.total]);
    const csv = [head, ...lines, [], [`${dim} distribution`, "A", "B", "C", "Unassigned", "Total"], ...dist]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `npp-category-analytics-${period}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader breadcrumb={<Link href="/npp" className="hover:underline">NPP</Link>} title="Category Analytics"
        description="Communication by doctor category, from actual records. Current performance uses each doctor's category today; historical uses the category recorded when a campaign was sent."
        actions={<Button variant="outline" onClick={exportCsv} disabled={!data}><Download className="h-4 w-4" /> Export CSV</Button>} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        {period === "custom" && <>
          <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </>}
      </div>

      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading || !data ? <Skeleton className="h-96" /> : (
        <div className="space-y-5">
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            {rows.map((r) => (
              <Card key={r.key} interactive className="p-4">
                <p className={cn("inline-flex rounded-md bg-gradient-to-r px-2 py-0.5 text-xs font-bold", CATEGORY_META[r.key].head)}>{r.label}</p>
                <p className="mt-2 text-[26px] font-bold leading-none tabular-nums">{number(r.doctors)}</p>
                <p className="text-xs text-ink-soft">doctors</p>
                <p className="mt-2 text-xs text-ink-muted">Reply rate: email <b>{pct(r.email_reply_rate)}</b> · WhatsApp <b>{pct(r.whatsapp_reply_rate)}</b></p>
                <p className="text-xs text-ink-muted">Engaged: <b>{number(r.engaged_doctors)}</b> of {number(r.contacted_doctors)} contacted ({pct(r.engagement_rate)})</p>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Communication by category" description={PERIODS.find((p) => p[0] === period)?.[1]} />
            <CardBody className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="#EFE7D8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#473F35" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#776C5D" }} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Emails sent" fill="#87A96B" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="Email replies" fill="#465C36" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="WhatsApp sent" fill="#E09A36" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="WhatsApp replies" fill="#8F5413" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Current category performance" description="Each doctor counted under the category they have today." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Category</Th><Th>Doctors</Th><Th>Emails sent</Th><Th>Delivered</Th><Th>Delivery rate</Th><Th>Email replies</Th><Th>Reply rate</Th><Th>Failed</Th><Th>WhatsApp sent</Th><Th>WA replies</Th><Th>WA reply rate</Th><Th>Engagement</Th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <Td className="font-semibold">{r.label}</Td><Td>{number(r.doctors)}</Td>
                      <Td>{number(r.email_sent ?? 0)}</Td><Td>{number(r.email_delivered ?? 0)}</Td><Td>{pct(r.email_delivery_rate)}</Td>
                      <Td>{number(r.email_replies ?? 0)}</Td><Td>{pct(r.email_reply_rate)}</Td><Td className="text-red-600">{number((r.email_failed ?? 0) + (r.whatsapp_failed ?? 0))}</Td>
                      <Td>{number(r.whatsapp_sent ?? 0)}</Td><Td>{number(r.whatsapp_replies ?? 0)}</Td><Td>{pct(r.whatsapp_reply_rate)}</Td>
                      <Td>{pct(r.engagement_rate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line/70 px-5 py-2.5 text-[11px] text-ink-soft">
              Email “delivered” needs provider delivery receipts; plain SMTP only confirms acceptance, so delivery rate stays blank for SMTP email.
            </p>
          </Card>

          <Card>
            <CardHeader title="Historical category performance" description="Dashboard campaigns, grouped by the category each doctor had when the message was sent. Later category changes do not rewrite this." />
            {!data.historical.length ? <EmptyState title="No dashboard campaigns in this period" description="Campaigns sent from Outreach appear here." /> : (
              <table className="w-full text-sm">
                <thead><tr><Th>Category at send</Th><Th>Channel</Th><Th>Messages</Th><Th>Sent</Th><Th>Delivered</Th><Th>Failed</Th></tr></thead>
                <tbody>{data.historical.map((h, i) => (
                  <tr key={i}><Td className="font-semibold">{CATEGORY_META[(h.category_at_send as CategoryKey) ?? "UNASSIGNED"]?.label ?? h.category_at_send}</Td><Td>{h.channel === "EMAIL" ? "Email" : "WhatsApp"}</Td>
                    <Td>{number(h.total)}</Td><Td>{number(h.sent)}</Td><Td>{number(h.delivered)}</Td><Td className="text-red-600">{number(h.failed)}</Td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardHeader title="Category distribution" description="Top 10, stacked by category."
              action={<Select className="w-auto" value={dim} onChange={(e) => setDim(e.target.value as typeof dim)} aria-label="Distribution by">
                <option value="specialty">Specialization</option><option value="state">State</option><option value="city">City</option><option value="hospital">Hospital</option>
              </Select>} />
            <CardBody className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.distribution[dim]} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#EFE7D8" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#776C5D" }} />
                  <YAxis type="category" dataKey="name" width={170} interval={0} tick={{ fontSize: 11, fill: "#473F35" }} tickFormatter={(v: string) => (v.length > 26 ? v.slice(0, 25) + "…" : v)} />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {CATEGORY_KEYS.map((k) => <Bar key={k} dataKey={k} name={CATEGORY_META[k].label} stackId="c" fill={CATEGORY_META[k].bar} maxBarSize={16} />)}
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
            <p className="border-t border-line/70 px-5 py-2.5 text-[11px] text-ink-soft">Zone is not in the NPP sheets yet, so zone-wise distribution isn&apos;t available. Add a Zone column to the MSL sheet to enable it.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
