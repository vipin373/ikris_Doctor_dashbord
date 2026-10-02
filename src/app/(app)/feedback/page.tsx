"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Copy, MessageSquareHeart, Search, Star } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone, statusTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Td, Th, Tooltip as Tip } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { FeedbackRow, Paged } from "@/lib/types";
import { DEPARTMENT_LABEL, formatDate, ISSUE_LABEL, number } from "@/lib/utils";

type Summary = {
  total: number;
  by_status: Record<string, number>;
  by_division: Record<string, number>;
  top_medicines: { medicine: string; count: number }[];
  by_month: { month: string; count: number }[];
  ratings: Record<string, number>;
  follow_up_required: number;
};

export default function FeedbackPage() {
  const { me } = useAuth();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => setPage(1), [debounced, status, department]);

  const summary = useQuery({ queryKey: ["feedback-summary"], queryFn: () => api.get<Summary>("/feedback/summary") });
  const list = useQuery({
    queryKey: ["feedback", debounced, status, department, page],
    queryFn: () => api.get<Paged<FeedbackRow>>("/feedback", { q: debounced, status, department, page, page_size: 25 }),
    placeholderData: keepPreviousData,
  });
  const s = summary.data;
  const months = (s?.by_month ?? []).map((m) => ({
    ...m,
    label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
  }));

  return (
    <div>
      <PageHeader title="Patient Feedback" description="Patients asked for a Google review on WhatsApp after receiving their medicine. Synced from the Patient Feedback sheet." />
      {summary.error && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!s ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <StatCard label="Feedback requests" value={number(s.total)} icon={MessageSquareHeart} />
            <StatCard label="Review link sent" value={number(s.by_status["Sent"])} icon={CheckCircle2} tone="green" />
            <StatCard label="Skipped as duplicate" value={number(s.by_status["Duplicate"])} icon={Copy} tone="amber" />
            <StatCard label="Ratings received" value={number(Object.values(s.ratings).reduce((a, b) => a + b, 0))} icon={Star} tone="violet"
              hint="Ratings and comments are not captured in the sheet yet" />
          </>
        )}
      </div>

      {s && s.total > 0 && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Requests by month" />
            <CardBody className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months}>
                  <CartesianGrid vertical={false} stroke="#EEF2F7" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#334155" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#F1F5F9" }} />
                  <Bar dataKey="count" name="Requests" fill="#172A5C" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Top medicines" description={Object.entries(s.by_division).map(([k, v]) => `${k}: ${v}`).join(" · ")} />
            <CardBody className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.top_medicines} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid horizontal={false} stroke="#EEF2F7" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="medicine" width={120} tick={{ fontSize: 11, fill: "#334155" }} />
                  <Tooltip cursor={{ fill: "#F1F5F9" }} />
                  <Bar dataKey="count" name="Requests" fill="#4C6FB5" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </div>
      )}

      <Card className="mt-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input className="pl-9" placeholder="Search patient, medicine or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(s?.by_status ?? {}).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
          {me && me.departments.length > 1 && (
            <Select className="w-44" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {me.departments.map((d) => <option key={d} value={d}>{DEPARTMENT_LABEL[d]}</option>)}
            </Select>
          )}
        </div>
        {list.error ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <Th>Request date</Th><Th>Patient</Th><Th>Phone</Th><Th>Medicine</Th><Th>Department</Th><Th>WhatsApp status</Th><Th>Sent date</Th><Th>Rating</Th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><Td colSpan={8}><Skeleton className="h-5" /></Td></tr>
                ))}
                {list.data?.items.length === 0 && (
                  <tr><td colSpan={8}><EmptyState title="No feedback found." description="Try changing your filters or search criteria." /></td></tr>
                )}
                {list.data?.items.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-50/40">
                    <Td className="whitespace-nowrap">{formatDate(r.request_date)}</Td>
                    <Td className="font-medium">
                      {r.patient_name || "—"}
                      {r.data_issues.length > 0 && (
                        <Tip label={r.data_issues.map((i) => ISSUE_LABEL[i] ?? i).join(" · ")}>
                          <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-amber-500" />
                        </Tip>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">{r.country_code ? `+${r.country_code} ` : ""}{r.phone_number}</Td>
                    <Td>{r.medicine}</Td>
                    <Td><Badge tone={departmentTone(r.department)}>{r.division || DEPARTMENT_LABEL[r.department]}</Badge></Td>
                    <Td><Badge tone={statusTone(r.whatsapp_status || "Pending")}>{r.whatsapp_status || "Pending"}</Badge></Td>
                    <Td className="whitespace-nowrap">{formatDate(r.sent_date)}</Td>
                    <Td>{r.rating ? `${r.rating}/5` : <span className="text-ink-soft">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onPage={setPage} />
      </Card>
    </div>
  );
}
