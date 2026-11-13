"use client";

import * as React from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, PageHeader, Pagination, Skeleton, Td, Th } from "@/components/ui/misc";
import { DrugLink, StatusBadge, VerifyDialog, useMeta, type DrugRow, type MatrixCell } from "@/components/drug-intel/shared";
import { api } from "@/lib/api";
import { cn, number } from "@/lib/utils";

export default function VerificationPage() {
  const { me } = useAuth();
  const meta = useMeta();
  const isAdmin = me?.role === "ADMIN";
  const [mode, setMode] = React.useState<"country" | "pending">("country");
  const [country, setCountry] = React.useState("JP");
  const [focus, setFocus] = React.useState({ oncology: "true", rare: "" });
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [target, setTarget] = React.useState<{ drug: DrugRow; cell: MatrixCell } | null>(null);
  const params = mode === "pending" ? { preset: "pending", q } : { country, status: "Not Verified", q, oncology: focus.oncology || undefined, rare: focus.rare || undefined };
  const list = useQuery({
    queryKey: ["drug-intel-list", "verification", params, page],
    queryFn: () => api.get<{ items: DrugRow[]; total: number }>("/drug-intel/drugs", { ...params, page, page_size: 25, sort: "regions" }),
    placeholderData: keepPreviousData,
  });
  const c = meta.data?.countries.find((x) => x.code === country);

  return (
    <div>
      <PageHeader title="Regulatory Verification" breadcrumb={<Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link>}
        description="Work through medicines that have not been checked for a country yet. Record only what the official register shows." />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setMode("country"); setPage(1); }} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", mode === "country" ? "border-walnut-700 bg-walnut-700 text-white" : "border-line bg-white")}>Not yet checked for a country</button>
          <button onClick={() => { setMode("pending"); setPage(1); }} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", mode === "pending" ? "border-walnut-700 bg-walnut-700 text-white" : "border-line bg-white")}>Flagged for review</button>
          {mode === "country" && (
            <>
              <Select className="w-48" value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }} aria-label="Country">
                {meta.data?.countries.filter((x) => x.code !== "US").map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </Select>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={focus.oncology === "true"} onChange={(e) => setFocus({ ...focus, oncology: e.target.checked ? "true" : "" })} />Oncology only</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={focus.rare === "true"} onChange={(e) => setFocus({ ...focus, rare: e.target.checked ? "true" : "" })} />Rare disease only</label>
            </>
          )}
          <Input className="ml-auto w-60" placeholder="Search medicine…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        {mode === "country" && c && (
          <p className="mt-3 text-xs text-ink-soft">
            Check each medicine in the {c.authority} register for {c.name}
            {country === "JP" && <> (e.g. <a className="text-sage-700 underline" href="https://www.pmda.go.jp/english/review-services/reviews/approved-information/drugs/0001.html" target="_blank" rel="noopener noreferrer">PMDA approved products</a> or <a className="text-sage-700 underline" href="https://www.pmda.go.jp/PmdaSearch/iyakuSearch/" target="_blank" rel="noopener noreferrer">PMDA drug search</a>)</>}
            {country === "GB" && <> (e.g. <a className="text-sage-700 underline" href="https://products.mhra.gov.uk/" target="_blank" rel="noopener noreferrer">MHRA products</a>)</>}
            . If the search finds nothing, record &ldquo;No Approval Record Found&rdquo; with the search terms used. Bulk results can be uploaded on <Link className="text-sage-700 underline" href="/drug-intel/import">Import &amp; sync</Link>.
          </p>
        )}
      </Card>
      <Card className="overflow-hidden">
        {list.isLoading ? <Skeleton className="m-4 h-48" /> : list.data?.items.length === 0 ? <EmptyState title="Nothing waiting" description="Every medicine in this view has a recorded check." /> : (
          <>
            <table className="w-full">
              <thead><tr><Th>Medicine</Th><Th>USA</Th><Th>EU</Th><Th>{mode === "country" ? c?.name ?? country : "Japan"}</Th><Th>Area</Th><Th /></tr></thead>
              <tbody>
                {list.data?.items.map((d) => (
                  <tr key={d.id} className="hover:bg-cream/40">
                    <Td><DrugLink id={d.id} name={d.generic_name} /><p className="text-[11px] text-ink-soft">{d.brand_names.slice(0, 3).join(", ")}</p></Td>
                    <Td><StatusBadge small status={d.us_status} /></Td>
                    <Td><StatusBadge small status={d.eu_status} /></Td>
                    <Td><StatusBadge small status={mode === "country" ? "Not Verified" : d.jp_status} /></Td>
                    <Td className="text-xs">{d.therapeutic_area ?? "—"}</Td>
                    <Td>
                      {isAdmin ? (
                        mode === "country" ? (
                          <Button size="sm" variant="outline" onClick={() => setTarget({ drug: d, cell: { country, name: c?.name ?? country, region: c?.region ?? "Other", authority: c?.authority ?? "", record: null, status: "Not Verified", has_record: false } })}>
                            <ShieldCheck className="h-3.5 w-3.5" />Record check
                          </Button>
                        ) : <Link href={`/drug-intel/drugs/${d.id}`}><Button size="sm" variant="outline">Review</Button></Link>
                      ) : <span className="text-[11px] text-ink-soft">Admin records checks</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-soft">{number(list.data?.total ?? 0)} medicines in this view.</p>
      {target && <VerifyDialog open onOpenChange={(v) => !v && setTarget(null)} drugId={target.drug.id} cell={target.cell} />}
    </div>
  );
}
