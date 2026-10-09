"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, Pagination, Skeleton, StatCard, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { AREA_LABEL, AREA_TONE, fdaDate, type Classification, type FdaDrug, type FdaOverview, type SyncRun } from "@/lib/fda";
import { formatDateTime, number } from "@/lib/utils";

export function AreaBadge({ value }: { value?: string | null }) {
  const v = value || "NEEDS_REVIEW";
  return <Badge tone={AREA_TONE[v] ?? "neutral"}>{AREA_LABEL[v] ?? v}</Badge>;
}

export function DrugIntelligence() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const overview = useQuery({ queryKey: ["fda-overview"], queryFn: () => api.get<FdaOverview>("/fda/overview") });
  const drugs = useQuery({
    queryKey: ["fda-drugs", debounced, dept, page],
    queryFn: () => api.get<{ items: FdaDrug[]; total: number }>("/fda/drugs", { q: debounced, department: dept, page, page_size: 25 }),
  });

  const by = overview.data?.by_department ?? {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total drugs" value={overview.isLoading ? "…" : number(overview.data?.total)} />
        <StatCard label="Oncology" value={overview.isLoading ? "…" : number(by.ONCOLOGY)} tone="sky" />
        <StatCard label="Hematology" value={overview.isLoading ? "…" : number(by.HEMATOLOGY)} tone="red" />
        <StatCard label="Rare Disease" value={overview.isLoading ? "…" : number(by.RARE_DISEASE)} tone="violet" />
        <StatCard label="Other" value={overview.isLoading ? "…" : number(by.OTHER)} />
        <StatCard label="Needs review" value={overview.isLoading ? "…" : number(overview.data?.needs_review)} tone="amber"
          hint="Never offered for sending" />
      </div>

      <SyncCard overview={overview.data} isAdmin={me?.role === "ADMIN"} onDone={() => {
        qc.invalidateQueries({ queryKey: ["fda-overview"] });
        qc.invalidateQueries({ queryKey: ["fda-drugs"] });
      }} />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drug, ingredient, manufacturer, NDA/BLA…" className="pl-8" />
          </div>
          <Select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className="w-auto" aria-label="Department">
            <option value="">All areas</option>
            <option value="ONCOLOGY">Oncology</option>
            <option value="HEMATOLOGY">Hematology</option>
            <option value="RARE_DISEASE">Rare Disease</option>
            <option value="OTHER">Other</option>
            <option value="NEEDS_REVIEW">Needs review</option>
          </Select>
          {me?.role === "ADMIN" && (overview.data?.needs_review ?? 0) > 0 && <AiReviewButton />}
        </div>
        {drugs.error ? <div className="p-4"><ErrorState error={drugs.error} onRetry={() => drugs.refetch()} /></div>
          : drugs.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
          : !drugs.data?.items.length ? (
            <EmptyState icon={ShieldCheck} title={overview.data?.total ? "No drugs match" : "No FDA data yet"}
              description={overview.data?.total ? "Try another search or area." : me?.role === "ADMIN"
                ? "Run Sync Now above to load drugs from the FDA." : "An administrator needs to run the first FDA sync."} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><Th>Drug</Th><Th>Active ingredient</Th><Th>Department</Th><Th>FDA status</Th><Th>Approval date</Th><Th>Source</Th></tr></thead>
                  <tbody>
                    {drugs.data.items.map((d) => (
                      <tr key={d.id} onClick={() => setOpenId(d.id)} className="cursor-pointer hover:bg-slate-50/70">
                        <Td>
                          <p className="font-medium text-ink">{d.drug_name}</p>
                          <p className="text-[11px] text-ink-soft">{d.application_number}{d.manufacturer ? ` · ${d.manufacturer}` : ""}</p>
                        </Td>
                        <Td className="max-w-[240px] text-ink-muted"><span className="line-clamp-2">{d.active_ingredient || d.generic_name || "—"}</span></Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {d.classification_status === "NEEDS_REVIEW" ? <AreaBadge value="NEEDS_REVIEW" />
                              : (d.therapeutic_areas.length ? d.therapeutic_areas : [d.department]).map((a) => <AreaBadge key={a} value={a} />)}
                          </div>
                        </Td>
                        <Td>{d.fda_status ? <Badge tone="green">{d.fda_status}</Badge> : <span className="text-xs text-ink-soft">Not in Drugs@FDA</span>}</Td>
                        <Td className="whitespace-nowrap tabular-nums">{fdaDate(d.approval_date)}</Td>
                        <Td className="text-xs text-ink-soft">openFDA</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={25} total={drugs.data.total} onPage={setPage} />
            </>
          )}
      </Card>
      {openId && <DrugDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SyncCard({ overview, isAdmin, onDone }: { overview?: FdaOverview; isAdmin: boolean; onDone: () => void }) {
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ fetched: number; new: number; updated: number; unchanged: number; failed: number; stream: number; streams: number } | null>(null);
  const last = overview?.last_sync;

  const run = async (restart = false) => {
    setRunning(true);
    const acc = { fetched: 0, new: 0, updated: 0, unchanged: 0, failed: 0, stream: 0, streams: 0 };
    setProgress(acc);
    try {
      let first = true;
      for (let i = 0; i < 60; i++) {
        const r = await api.post<{ done: boolean; status: string; fetched: number; new: number; updated: number; unchanged: number; failed: number; stream: number; streams: number; errors: string[] }>(
          "/fda/sync", { mode: "AUTO", restart: first && restart });
        first = false;
        acc.fetched += r.fetched; acc.new += r.new; acc.updated += r.updated; acc.unchanged += r.unchanged; acc.failed += r.failed;
        acc.stream = r.stream; acc.streams = r.streams;
        setProgress({ ...acc });
        onDone();
        if (r.done) {
          if (r.status === "FAILED") toast.error("FDA synchronization failed. Please try again.", { description: r.errors?.[0] });
          else toast.success(`FDA sync finished: ${acc.new} new, ${acc.updated} updated, ${acc.unchanged} unchanged${acc.failed ? `, ${acc.failed} failed` : ""}.`);
          break;
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "FDA synchronization failed. Please try again.");
    } finally {
      setRunning(false);
      onDone();
    }
  };

  const stale = last?.status === "RUNNING" && !running;
  return (
    <Card>
      <CardHeader title="FDA Drug Synchronization"
        description="Prescription NDA/BLA products whose FDA label indication covers oncology, hematology or rare disease. Updates existing records; never duplicates."
        action={isAdmin && (
          <div className="flex gap-2">
            {stale && <Button variant="outline" size="sm" disabled={running} onClick={() => run(true)}>Restart</Button>}
            <Button size="sm" disabled={running} onClick={() => run(false)}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {running ? "Syncing…" : stale ? "Continue sync" : "Sync Now"}
            </Button>
          </div>
        )} />
      <CardBody className="grid grid-cols-2 gap-4 text-sm md:grid-cols-6">
        <Info label="Last sync" value={last ? formatDateTime(last.finished_at || last.started_at) : "Never"} />
        <Info label="Status" value={last ? <Badge tone={statusTone(last.status)}>{last.status === "RUNNING" ? (running ? "Running" : "Unfinished") : last.status}</Badge> : "—"} />
        <Info label="New drugs" value={number(running && progress ? progress.new : last?.new_count)} />
        <Info label="Updated" value={number(running && progress ? progress.updated : last?.updated_count)} />
        <Info label="Unchanged" value={number(running && progress ? progress.unchanged : last?.unchanged_count)} />
        <Info label="Failed" value={number(running && progress ? progress.failed : last?.failed_count)} />
      </CardBody>
      {running && progress && (
        <div className="border-t border-line px-5 py-2.5 text-xs text-ink-soft">
          <div className="mb-1.5 h-1.5 overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-brand-700 transition-all" style={{ width: `${progress.streams ? Math.round((progress.stream / progress.streams) * 100) : 3}%` }} />
          </div>
          Read {number(progress.fetched)} FDA labels so far (search {Math.min(progress.stream + 1, progress.streams || 1)} of {progress.streams || "…"}). Keep this tab open; a first full sync takes a few minutes.
        </div>
      )}
      {!running && last?.errors?.length ? (
        <div className="border-t border-line px-5 py-2 text-xs text-red-700">Last error: {last.errors[last.errors.length - 1]}</div>
      ) : null}
      {overview?.last_sync?.source_last_updated && (
        <div className="border-t border-line px-5 py-2 text-[11px] text-ink-soft">openFDA data last updated by FDA on {fdaDate(overview.last_sync.source_last_updated)}.</div>
      )}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <div className="mt-1 font-medium text-ink tabular-nums">{value}</div>
    </div>
  );
}

function AiReviewButton() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post<{ items: { status: string }[] }>("/fda/drugs/classify-ai?limit=8"),
    onSuccess: (r) => {
      const ok = r.items.filter((i) => i.status === "AUTO").length;
      toast.success(`AI reviewed ${r.items.length}: ${ok} classified with a quote from the FDA label, ${r.items.length - ok} still need a person.`);
      qc.invalidateQueries({ queryKey: ["fda-overview"] });
      qc.invalidateQueries({ queryKey: ["fda-drugs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "AI classification failed"),
  });
  return (
    <Button variant="outline" size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
      {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI second opinion on review queue
    </Button>
  );
}

export function DrugDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["fda-drug", id],
    queryFn: () => api.get<{ drug: FdaDrug; classifications: Classification[]; kegg: Record<string, string> | null; kegg_enabled: boolean }>(`/fda/drugs/${id}`),
  });
  const [review, setReview] = React.useState<{ department: string; areas: string[]; reason: string } | null>(null);
  const save = useMutation({
    mutationFn: (action: "APPROVED" | "REJECTED") => api.post(`/fda/drugs/${id}/classification`, {
      department: review!.department, therapeutic_areas: review!.areas.length ? review!.areas : [review!.department], action, reason: review!.reason,
    }),
    onSuccess: () => {
      toast.success("Classification saved");
      setReview(null);
      qc.invalidateQueries({ queryKey: ["fda-drug", id] });
      qc.invalidateQueries({ queryKey: ["fda-drugs"] });
      qc.invalidateQueries({ queryKey: ["fda-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const kegg = useMutation({
    mutationFn: () => api.post<{ found: boolean; conflict: string | null }>(`/fda/drugs/${id}/kegg`),
    onSuccess: (r) => {
      toast[r.found ? "success" : "info"](r.found ? (r.conflict ? "KEGG reference saved; it disagrees with FDA and is flagged for review." : "KEGG reference saved.") : "No KEGG entry found.");
      qc.invalidateQueries({ queryKey: ["fda-drug", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "KEGG lookup failed"),
  });

  const d = data?.drug;
  const current = data?.classifications?.[0];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={d?.drug_name ?? "FDA drug"}
      description={d ? `${d.application_number} · ${d.fda_source}` : undefined}>
      {error ? <ErrorState error={error} /> : isLoading || !d ? <Skeleton className="h-64" /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {d.drugs_at_fda_url && <a href={d.drugs_at_fda_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-slate-50">View FDA Source (Drugs@FDA) <ExternalLink className="h-3 w-3" /></a>}
            {d.label_url && <a href={d.label_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-slate-50">FDA label (DailyMed) <ExternalLink className="h-3 w-3" /></a>}
            {d.fda_source_url && <a href={d.fda_source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-slate-50">openFDA record <ExternalLink className="h-3 w-3" /></a>}
          </div>
          {d.review_flags?.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{d.review_flags.map((f) => <p key={f}>{f}</p>)}</div>
          ) : null}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <Field label="Drug name" value={d.drug_name} />
            <Field label="Brand name" value={d.brand_name} />
            <Field label="Generic name" value={d.generic_name} />
            <Field label="Active ingredient" value={d.active_ingredient} />
            <Field label="Manufacturer / applicant" value={d.manufacturer} />
            <Field label="Application number" value={d.application_number} />
            <Field label="Dosage form" value={d.dosage_form} />
            <Field label="Strength" value={d.strength} />
            <Field label="Route" value={d.route} />
            <Field label="Therapeutic area" value={<div className="flex flex-wrap gap-1">{d.classification_status === "NEEDS_REVIEW" ? <AreaBadge value="NEEDS_REVIEW" /> : d.therapeutic_areas.map((a) => <AreaBadge key={a} value={a} />)}</div>} />
            <Field label="FDA status" value={d.fda_status} />
            <Field label="Approval date" value={fdaDate(d.approval_date)} />
            <Field label="Latest FDA action" value={fdaDate(d.latest_action_date)} />
            <Field label="Marketing status" value={d.marketing_status} />
            <Field label="Pharmacologic class" value={d.pharm_class?.join("; ")} />
            <Field label="Label effective" value={fdaDate(d.label_effective_date)} />
            <Field label="Last updated" value={formatDateTime(d.last_synced_at)} />
            <Field label="KEGG source" value={data?.kegg ? <a className="text-brand-700 underline" href={data.kegg.kegg_source_url} target="_blank" rel="noreferrer">{data.kegg.kegg_id}</a> : (data?.kegg_enabled ? "Not fetched" : "KEGG not enabled")} />
          </dl>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Indication (FDA label)</p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md bg-slate-50 p-3 text-[13px] leading-relaxed text-ink">{d.indication || "Not available"}</p>
          </div>
          {data?.kegg?.conflict && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.kegg.conflict}</p>}
          {current && (
            <div className="rounded-md border border-line p-3 text-xs">
              <p className="font-medium text-ink">Classification: {AREA_LABEL[current.department] ?? current.department} · confidence {Math.round(current.confidence * 100)}% · {current.source === "FDA_LABEL_RULES" ? "FDA label evidence" : current.source === "OPENROUTER" ? `AI (${current.model})` : "Manual review"}</p>
              <p className="mt-1 text-ink-muted">{current.reason}</p>
              {current.evidence?.length ? <p className="mt-1 text-ink-soft">Evidence: {current.evidence.slice(0, 8).map((e) => `“${e}”`).join(", ")}</p> : null}
            </div>
          )}
          {me?.role === "ADMIN" && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" variant="outline" onClick={() => setReview({ department: d.department ?? "ONCOLOGY", areas: d.therapeutic_areas.filter((a) => a !== "OTHER"), reason: "" })}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Review classification
              </Button>
              {data?.kegg_enabled && <Button size="sm" variant="outline" disabled={kegg.isPending} onClick={() => kegg.mutate()}>Fetch KEGG reference</Button>}
            </div>
          )}
          {review && (
            <div className="space-y-3 rounded-md border border-brand-200 bg-brand-50/40 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Primary department</Label>
                  <Select value={review.department} onChange={(e) => setReview({ ...review, department: e.target.value })}>
                    {["ONCOLOGY", "HEMATOLOGY", "RARE_DISEASE", "OTHER"].map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Also relevant to</Label>
                  <div className="flex flex-wrap gap-3 pt-2 text-xs">
                    {["ONCOLOGY", "HEMATOLOGY", "RARE_DISEASE"].map((a) => (
                      <label key={a} className="inline-flex items-center gap-1">
                        <input type="checkbox" checked={review.areas.includes(a)} onChange={(e) => setReview({ ...review, areas: e.target.checked ? [...review.areas, a] : review.areas.filter((x) => x !== a) })} />
                        {AREA_LABEL[a]}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <Label>Reason (based on the FDA label)</Label>
                <Textarea rows={2} value={review.reason} onChange={(e) => setReview({ ...review, reason: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
                <Button size="sm" variant="outline" disabled={save.isPending || review.reason.length < 3} onClick={() => save.mutate("REJECTED")}>Exclude from messaging</Button>
                <Button size="sm" disabled={save.isPending || review.reason.length < 3} onClick={() => save.mutate("APPROVED")}>Approve classification</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-ink">{value === null || value === undefined || value === "" ? "—" : value}</dd>
    </div>
  );
}

export type { SyncRun };
