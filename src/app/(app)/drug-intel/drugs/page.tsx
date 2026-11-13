"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Columns3, Download, ExternalLink, Eye, FilePlus2, Plus, Search, Users, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Td, Th } from "@/components/ui/misc";
import { DrugLink, OrphanLabel, RuleNotice, StatusBadge, useMeta, type DrugRow } from "@/components/drug-intel/shared";
import { NewDrugDialog } from "@/components/drug-intel/drug-form";
import { api } from "@/lib/api";
import { cn, formatDate, number } from "@/lib/utils";

const FILTER_KEYS = ["q", "region", "country", "authority", "status", "area", "oncology", "rare", "orphan", "manufacturer", "year", "verification", "preset", "sort"] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

function titleFor(f: Filters): { title: string; description: string } {
  if (f.country === "US" && f.status === "Approved") return { title: "USA Drug Approvals", description: "FDA approvals from Drugs@FDA (openFDA). Marketing status is shown separately." };
  if (f.region === "Europe") return { title: "Europe Drug Approvals", description: "EU centralised (EMA) records plus verified national / UK records. EU approval is not proof of marketing in every country." };
  if (f.country === "JP") return { title: "Japan Drug Approvals", description: "PMDA records entered after verification by Ikris staff." };
  if (f.oncology === "true") return { title: "Oncology Medicines", description: "ATC L01/L02 or a cancer indication in the source record." };
  if (f.rare === "true") return { title: "Rare Disease Medicines", description: "Orphan status or a rare-disease indication in the source record." };
  if (f.orphan === "true") return { title: "Orphan Drugs", description: "Orphan status as stated by the regulator's own data." };
  if (f.preset === "recent") return { title: "Recently Approved Medicines", description: "Approved in any jurisdiction in the last 12 months." };
  if (f.preset === "multi") return { title: "Approved in Multiple Regions", description: "Approved in at least two of USA, Europe and Japan." };
  return { title: "Drug Master Database", description: "Every medicine with a separate record per country. Click a medicine for its full country matrix." };
}

function DrugsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useAuth();
  const meta = useMeta();
  const f: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)) as Filters;
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = React.useState(f.q ?? "");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [newOpen, setNewOpen] = React.useState(false);

  const setParam = React.useCallback((patch: Filters & { page?: string }) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in patch)) next.delete("page");
    router.replace(`/drug-intel/drugs${next.toString() ? `?${next}` : ""}`, { scroll: false });
  }, [params, router]);

  React.useEffect(() => {
    const t = setTimeout(() => { if ((f.q ?? "") !== q) setParam({ q }); }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery({
    queryKey: ["drug-intel-list", f, page],
    queryFn: () => api.get<{ items: DrugRow[]; total: number; page_size: number }>("/drug-intel/drugs", { ...f, page, page_size: 25 }),
    placeholderData: keepPreviousData,
  });
  const { title, description } = titleFor(f);
  const active = FILTER_KEYS.filter((k) => k !== "sort" && f[k]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));

  return (
    <div>
      <PageHeader title={title} description={description} breadcrumb={<Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link>}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => api.download("/drug-intel/export", { ...f, tab: "master", format: "csv", filtered: true }, "International_Drug_Master.csv")}>
            <Download className="h-3.5 w-3.5" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => api.download("/drug-intel/export", { ...f, tab: "all", format: "xlsx", filtered: true }, "Ikris_Drug_Intelligence_filtered.xlsx")}>
            <Download className="h-3.5 w-3.5" />Excel (current filters)
          </Button>
          {me?.role === "ADMIN" && <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-3.5 w-3.5" />Add medicine</Button>}
        </>}
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Generic, brand, KEGG ID, ingredient, disease…" aria-label="Search medicines" />
          </div>
          <Select value={f.region ?? ""} onChange={(e) => setParam({ region: e.target.value, country: undefined })} aria-label="Region">
            <option value="">All regions</option><option value="USA">USA</option><option value="Europe">Europe</option><option value="Japan">Japan</option><option value="Other">Other</option>
          </Select>
          <Select value={f.country ?? ""} onChange={(e) => setParam({ country: e.target.value, region: undefined })} aria-label="Country">
            <option value="">All countries</option>
            {meta.data?.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <Select value={f.status ?? ""} onChange={(e) => setParam({ status: e.target.value })} aria-label="Approval status">
            <option value="">Any status</option>
            {meta.data?.statuses.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select value={f.area ?? ""} onChange={(e) => setParam({ area: e.target.value })} aria-label="Therapeutic area">
            <option value="">All therapeutic areas</option>
            {meta.data?.areas.map((a) => <option key={a}>{a}</option>)}
          </Select>
          <Select value={f.authority ?? ""} onChange={(e) => setParam({ authority: e.target.value })} aria-label="Authority">
            <option value="">Any authority</option>
            {Array.from(new Set(meta.data?.countries.map((c) => c.authority) ?? [])).map((a) => <option key={a}>{a}</option>)}
          </Select>
          <Input value={f.manufacturer ?? ""} onChange={(e) => setParam({ manufacturer: e.target.value })} placeholder="Manufacturer / MAH" aria-label="Manufacturer" />
          <Input type="number" value={f.year ?? ""} onChange={(e) => setParam({ year: e.target.value })} placeholder="Approval year" aria-label="Approval year" />
          <Select value={f.verification ?? ""} onChange={(e) => setParam({ verification: e.target.value })} aria-label="Verification">
            <option value="">Any verification</option><option>Verified</option><option>Source-imported</option><option>Needs Review</option><option>Not Verified</option>
          </Select>
          <Select value={f.sort ?? "name"} onChange={(e) => setParam({ sort: e.target.value })} aria-label="Sort">
            <option value="name">Sort: name</option><option value="recent">Sort: latest approval</option><option value="regions">Sort: most regions</option><option value="updated">Sort: recently updated</option>
          </Select>
          <div className="flex flex-wrap items-center gap-1.5 md:col-span-2">
            {([["oncology", "Oncology"], ["rare", "Rare disease"], ["orphan", "Orphan"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setParam({ [k]: f[k] === "true" ? undefined : "true" })}
                className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition-colors", f[k] === "true" ? "border-sage-500 bg-sage-500 text-white" : "border-line bg-white text-ink-muted hover:border-sage-300")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {active.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            {active.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-walnut-800">
                {k}: {f[k]}<button aria-label={`Remove ${k}`} onClick={() => { if (k === "q") setQ(""); setParam({ [k]: undefined }); }}><X className="h-3 w-3" /></button>
              </span>
            ))}
            <button className="font-semibold text-sage-700 hover:underline" onClick={() => { setQ(""); router.replace("/drug-intel/drugs"); }}>Clear all</button>
          </div>
        )}
      </Card>

      <RuleNotice className="mb-3" />

      {selected.length > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex items-center justify-between rounded-xl border border-sage-200 bg-sage-50 px-4 py-2 text-sm shadow-card">
          <span>{selected.length} selected (max 5)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            <Link href={`/drug-intel/compare?ids=${selected.join(",")}`}><Button size="sm" disabled={selected.length < 2}><Columns3 className="h-3.5 w-3.5" />Compare</Button></Link>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isLoading ? <Skeleton className="m-4 h-64" /> :
          list.data && list.data.items.length === 0 ? <EmptyState title="No medicines match these filters" description="Try removing a filter. A medicine that is not in the database may still be approved — add it or import it." /> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px]">
                  <thead><tr>
                    <Th className="w-8" /><Th>Medicine</Th><Th>Brand names</Th><Th>KEGG ID</Th><Th>Therapeutic area</Th><Th>Manufacturer / MAH</Th>
                    <Th>USA</Th><Th>Europe (EU)</Th><Th>Japan</Th><Th>Orphan</Th><Th>Last verified</Th><Th>Actions</Th>
                  </tr></thead>
                  <tbody className={cn(list.isFetching && "opacity-70")}>
                    {list.data?.items.map((d) => (
                      <tr key={d.id} className="hover:bg-cream/40">
                        <Td><input type="checkbox" aria-label={`Select ${d.generic_name}`} checked={selected.includes(d.id)} onChange={() => toggle(d.id)} /></Td>
                        <Td>
                          <DrugLink id={d.id} name={d.generic_name} />
                          <p className="text-[11px] text-ink-soft">{d.id}{d.mapped_doctors > 0 && ` · ${d.mapped_doctors} doctors`}</p>
                          <div className="mt-0.5 flex gap-1">
                            {d.is_oncology && <span className="rounded bg-red-50 px-1 text-[10px] font-semibold text-red-700">Oncology</span>}
                            {d.is_rare && <span className="rounded bg-walnut-50 px-1 text-[10px] font-semibold text-walnut-700">Rare</span>}
                          </div>
                        </Td>
                        <Td className="max-w-[180px] text-xs text-ink-muted">{d.brand_names.slice(0, 4).join(", ")}{d.brand_names.length > 4 && ` +${d.brand_names.length - 4}`}</Td>
                        <Td className="text-xs">{d.kegg_drug_id ?? <span className="text-ink-soft">—</span>}</Td>
                        <Td className="text-xs">{d.therapeutic_area ?? <span className="text-ink-soft">Not stated</span>}</Td>
                        <Td className="max-w-[160px] text-xs text-ink-muted">{d.mah ?? d.manufacturer ?? "—"}</Td>
                        <Td><StatusBadge small status={d.us_status} />{d.us_date && <p className="mt-0.5 text-[10.5px] text-ink-soft">{formatDate(d.us_date)}</p>}</Td>
                        <Td><StatusBadge small status={d.eu_status} />{d.eu_date && <p className="mt-0.5 text-[10.5px] text-ink-soft">{formatDate(d.eu_date)}</p>}</Td>
                        <Td><StatusBadge small status={d.jp_status} />{d.jp_date && <p className="mt-0.5 text-[10.5px] text-ink-soft">{formatDate(d.jp_date)}</p>}</Td>
                        <Td><OrphanLabel d={d} /></Td>
                        <Td className="text-xs text-ink-soft">{d.last_verified ? formatDate(d.last_verified) : "—"}</Td>
                        <Td>
                          <div className="flex gap-0.5">
                            <Link href={`/drug-intel/drugs/${d.id}`} title="View details"><Button size="icon" variant="ghost" aria-label="View details"><Eye className="h-4 w-4" /></Button></Link>
                            <Link href={`/drug-intel/drugs/${d.id}#source`} title="Regulatory sources"><Button size="icon" variant="ghost" aria-label="Regulatory sources"><ExternalLink className="h-4 w-4" /></Button></Link>
                            <Link href={`/drug-intel/mapping?drug=${d.id}`} title="Map to doctors"><Button size="icon" variant="ghost" aria-label="Map to doctors"><Users className="h-4 w-4" /></Button></Link>
                            <Link href={`/drug-intel/requests?new=1&drug=${d.id}`} title="Add to NPP request"><Button size="icon" variant="ghost" aria-label="Add to NPP request"><FilePlus2 className="h-4 w-4" /></Button></Link>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => setParam({ page: String(p) })} />
            </>
          )}
      </Card>
      <p className="mt-2 text-[11px] text-ink-soft">{number(list.data?.total ?? 0)} medicines. Tick up to 5 to compare. EU data: Source: European Medicines Agency (EMA).</p>
      {newOpen && <NewDrugDialog open onOpenChange={setNewOpen} />}
    </div>
  );
}

export default function DrugsPage() {
  return <React.Suspense fallback={<Skeleton className="h-96" />}><DrugsInner /></React.Suspense>;
}
