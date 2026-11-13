"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import {
  Activity, BadgeCheck, Database, Dna, Download, FlaskConical, Globe2, Layers, Microscope, RefreshCw, Ribbon, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, PageHeader, Skeleton, StatCard } from "@/components/ui/misc";
import { RuleNotice } from "@/components/drug-intel/shared";
import { api } from "@/lib/api";
import { formatDateTime, number } from "@/lib/utils";

interface Summary {
  total: number; us_approved: number; eu_approved: number; jp_approved: number; multi_region: number; recent: number;
  oncology: number; rare: number; orphan: number; pending: number; mapped_drugs: number; jp_records: number; is_admin: boolean;
  last_imports: { source: string; status: string; counts: Record<string, number>; started_at: string; finished_at: string | null }[];
}
interface Reports {
  by_country: { country: string; name: string; approved: number; other: number; oncology: number }[];
  by_year: { year: number; us: number; eu: number; jp: number; europe_national: number }[];
  requests_by_drug: { drug: string; requests: number }[];
  mapped: { id: string; generic_name: string; doctors: number }[];
}

const CARDS: { key: keyof Summary; label: string; href: string; icon: React.ComponentType<{ className?: string }>; tone: "brand" | "amber" | "violet" | "red" | "sky"; hint: string }[] = [
  { key: "total", label: "Total drugs in database", href: "/drug-intel/drugs", icon: Database, tone: "violet", hint: "Unique active substances" },
  { key: "us_approved", label: "USA approved", href: "/drug-intel/drugs?country=US&status=Approved", icon: BadgeCheck, tone: "brand", hint: "FDA (Drugs@FDA)" },
  { key: "eu_approved", label: "Europe approved", href: "/drug-intel/drugs?region=Europe&status=Approved", icon: Globe2, tone: "brand", hint: "EU centralised + verified national" },
  { key: "jp_approved", label: "Japan approved", href: "/drug-intel/drugs?country=JP&status=Approved", icon: Sparkles, tone: "amber", hint: "PMDA — admin-verified records" },
  { key: "multi_region", label: "Approved in 2+ regions", href: "/drug-intel/drugs?preset=multi", icon: Layers, tone: "sky", hint: "USA / Europe / Japan" },
  { key: "recent", label: "Recently approved", href: "/drug-intel/drugs?preset=recent&sort=recent", icon: Activity, tone: "amber", hint: "Any region, last 12 months" },
  { key: "oncology", label: "Oncology drugs", href: "/drug-intel/drugs?oncology=true", icon: Ribbon, tone: "red", hint: "ATC L01/L02 or cancer indication" },
  { key: "rare", label: "Rare disease drugs", href: "/drug-intel/drugs?rare=true", icon: Dna, tone: "violet", hint: "Orphan or rare-disease indication" },
  { key: "orphan", label: "Orphan drugs", href: "/drug-intel/drugs?orphan=true", icon: Microscope, tone: "sky", hint: "Orphan status stated by source" },
  { key: "pending", label: "Records pending verification", href: "/drug-intel/verification", icon: FlaskConical, tone: "amber", hint: "Needs a person to check" },
];

export default function DrugDashboardPage() {
  const summary = useQuery({ queryKey: ["drug-intel-summary"], queryFn: () => api.get<Summary>("/drug-intel/summary") });
  const reports = useQuery({ queryKey: ["drug-intel-reports"], queryFn: () => api.get<Reports>("/drug-intel/reports") });
  const s = summary.data;
  const years = (reports.data?.by_year ?? []).filter((y) => y.year >= new Date().getFullYear() - 15);

  return (
    <div>
      <PageHeader
        title="International Drug Intelligence"
        description="USA, Europe and Japan regulatory records from official sources, linked to your doctors and NPP requests."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => api.download("/drug-intel/export", { tab: "all", format: "xlsx" }, "Ikris_Drug_Intelligence.xlsx")}>
            <Download className="h-3.5 w-3.5" />Export all tabs (Excel)
          </Button>
          {s?.is_admin && <Link href="/drug-intel/import"><Button size="sm"><RefreshCw className="h-3.5 w-3.5" />Import &amp; sync</Button></Link>}
        </>}
      />
      <RuleNotice className="mb-5" />

      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
        <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {CARDS.map((c) => (
            <Link key={c.key} href={c.href} className="block rounded-card focus-visible:ring-2 focus-visible:ring-glow-400">
              {s ? <StatCard label={c.label} value={number(s[c.key] as number)} icon={c.icon} tone={c.tone}
                hint={c.key === "jp_approved" && s.jp_records === 0 ? "No Japan records yet — add via Import (PMDA)" : c.hint} />
                : <Skeleton className="h-[118px]" />}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="New approvals by year" description="Approval records with status Approved and a stated approval date (first approval of each substance per jurisdiction)" />
          <CardBody>
            {reports.isLoading ? <Skeleton className="h-64" /> : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={years} margin={{ left: -12, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ece6dc" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="us" name="USA (FDA)" fill="#5A3E2B" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="eu" name="EU (EMA)" fill="#87A96B" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="jp" name="Japan (PMDA)" fill="#D5851F" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Records by country" description="Approved vs other statuses; countries with no checks are not listed" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2">Country</th><th className="px-2 py-2 text-right">Approved</th><th className="px-2 py-2 text-right">Oncology</th><th className="px-4 py-2 text-right">Other</th>
              </tr></thead>
              <tbody>
                {(reports.data?.by_country ?? []).map((c) => (
                  <tr key={c.country} className="border-t border-line">
                    <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/drug-intel/drugs?country=${c.country}`}>{c.name}</Link></td>
                    <td className="px-2 py-2 text-right tabular-nums">{number(c.approved)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{number(c.oncology)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{number(c.other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Data sources & last sync" />
          <CardBody className="space-y-3 text-sm">
            {(s?.last_imports ?? []).length === 0 && <p className="text-ink-soft">No imports yet.</p>}
            {s?.last_imports.map((r) => (
              <div key={r.source} className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.source}</p>
                  <p className="text-xs text-ink-soft">{formatDateTime(r.finished_at ?? r.started_at)} · {number(r.counts.substances_in_file ?? (r.counts.approvals_created ?? 0) + (r.counts.approvals_changed ?? 0))} substances</p>
                </div>
                <span className={r.status === "failed" ? "text-xs font-semibold text-red-600" : "text-xs font-semibold text-sage-700"}>
                  {r.status === "partial" ? "done (some rows skipped)" : r.status}
                </span>
              </div>
            ))}
            <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-soft">
              EU data: Source: European Medicines Agency (EMA). USA: openFDA Drugs@FDA. Japan/UK/national records are entered from the official register after a person checks it. KEGG is not imported (commercial licence required).
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Medicines mapped to doctors" description={`${number(s?.mapped_drugs ?? 0)} medicines have confirmed doctors`} action={<Link className="text-xs font-semibold text-sage-700 hover:underline" href="/drug-intel/mapping">Open mapping →</Link>} />
          <CardBody className="space-y-1.5 text-sm">
            {(reports.data?.mapped ?? []).length === 0 && <p className="text-ink-soft">No mappings yet.</p>}
            {reports.data?.mapped.slice(0, 8).map((m) => (
              <div key={m.id} className="flex justify-between"><Link href={`/drug-intel/drugs/${m.id}`} className="hover:underline">{m.generic_name}</Link><span className="tabular-nums text-ink-soft">{m.doctors} doctors</span></div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="NPP requests by medicine" action={<Link className="text-xs font-semibold text-sage-700 hover:underline" href="/drug-intel/requests">Open requests →</Link>} />
          <CardBody className="space-y-1.5 text-sm">
            {(reports.data?.requests_by_drug ?? []).length === 0 && <p className="text-ink-soft">No NPP medicine requests yet.</p>}
            {reports.data?.requests_by_drug.slice(0, 8).map((m) => (
              <div key={m.drug} className="flex justify-between"><span>{m.drug}</span><span className="tabular-nums text-ink-soft">{m.requests}</span></div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
