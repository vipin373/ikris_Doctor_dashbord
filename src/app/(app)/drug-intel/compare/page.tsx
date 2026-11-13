"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { DrugPicker, SourceLink, StatusBadge, type MatrixCell } from "@/components/drug-intel/shared";
import type { DrugRecord } from "@/components/drug-intel/drug-form";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type CmpDrug = DrugRecord & { matrix: MatrixCell[] };

function cell(d: CmpDrug, code: string) {
  const m = d.matrix.find((x) => x.country === code);
  return (
    <div>
      <StatusBadge small status={m?.status} />
      {m?.record?.approval_date && <p className="mt-0.5 text-[11px] text-ink-soft">{formatDate(m.record.approval_date)}</p>}
    </div>
  );
}

function CompareInner() {
  const params = useSearchParams();
  const router = useRouter();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const setIds = (next: string[]) => router.replace(`/drug-intel/compare${next.length ? `?ids=${next.join(",")}` : ""}`);
  const q = useQuery({
    queryKey: ["drug-compare", ids.join(",")],
    queryFn: () => api.get<{ drugs: CmpDrug[]; notice: string }>("/drug-intel/compare", { ids: ids.join(",") }),
    enabled: ids.length >= 2,
  });
  const single = useQuery({
    queryKey: ["drug-intel-drug", ids[0]],
    queryFn: () => api.get<{ drug: DrugRecord }>(`/drug-intel/drugs/${ids[0]}`),
    enabled: ids.length === 1,
  });
  const drugs = q.data?.drugs ?? [];
  const rows: [string, (d: CmpDrug) => React.ReactNode][] = [
    ["Generic name", (d) => <Link className="font-semibold hover:underline" href={`/drug-intel/drugs/${d.id}`}>{d.generic_name}</Link>],
    ["Brand names", (d) => d.brand_names.join(", ") || "—"],
    ["Manufacturer / MAH", (d) => [d.manufacturer, d.mah].filter(Boolean).join(" / ") || "—"],
    ["Therapeutic area", (d) => d.therapeutic_area ?? "—"],
    ["Indications", (d) => <p className="line-clamp-6 text-xs">{d.indication ?? "—"}</p>],
    ["Dosage form", (d) => d.dosage_form ?? "—"],
    ["Strength", (d) => d.strength ?? "—"],
    ["USA approval", (d) => cell(d, "US")],
    ["Europe (EU) approval", (d) => cell(d, "EU")],
    ["UK approval", (d) => cell(d, "GB")],
    ["Japan approval", (d) => cell(d, "JP")],
    ["Orphan designation", (d) => d.orphan_label ?? "—"],
    ["Regulatory documents", (d) => <div className="space-y-0.5">{d.matrix.filter((m) => m.record?.source_url).map((m) => <div key={m.country}><SourceLink href={m.record!.source_url}>{m.country} record</SourceLink></div>)}{d.matrix.filter((m) => m.record?.label_url).map((m) => <div key={m.country + "l"}><SourceLink href={m.record!.label_url}>{m.country} label</SourceLink></div>)}</div>],
  ];
  return (
    <div>
      <PageHeader title="Drug Comparison" breadcrumb={<Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link>}
        description="Compare 2–5 medicines side by side." />
      <div className="mb-4 flex gap-2 rounded-xl border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        This comparison shows regulatory facts only. It does not mean the medicines are clinically equivalent or interchangeable, and it is not a treatment recommendation.
      </div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(ids.length === 1 ? [{ id: ids[0], generic_name: single.data?.drug.generic_name ?? ids[0] }] : drugs).map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-sage-50 px-3 py-1 text-sm ring-1 ring-sage-200">
              {d.generic_name}<button aria-label={`Remove ${d.generic_name}`} onClick={() => setIds(ids.filter((x) => x !== d.id))}><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {ids.length < 5 && <div className="w-72"><DrugPicker value={null} onChange={(d) => d && !ids.includes(d.id) && setIds([...ids, d.id])} placeholder="Add a medicine to compare…" /></div>}
        </div>
      </Card>
      {ids.length < 2 ? <EmptyState title="Choose at least two medicines" description="Search above or tick medicines in the database." /> :
        q.error ? <ErrorState error={q.error} /> : q.isLoading ? <Skeleton className="h-96" /> : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <tbody>
                {rows.map(([label, fn]) => (
                  <tr key={label} className="border-b border-line align-top">
                    <th className="w-44 bg-slate-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</th>
                    {drugs.map((d) => <td key={d.id} className="px-4 py-2.5 text-ink">{fn(d)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
    </div>
  );
}

export default function ComparePage() {
  return <React.Suspense fallback={<Skeleton className="h-96" />}><CompareInner /></React.Suspense>;
}
