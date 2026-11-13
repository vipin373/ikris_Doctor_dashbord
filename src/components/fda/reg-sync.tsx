"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { FdaOverview } from "@/lib/fda";
import { useRegulator } from "@/lib/regulator";
import { formatDateTime, number } from "@/lib/utils";

interface ImportResult { run_id: string; done: boolean; next?: number; pages?: number; new: number; updated: number; unchanged: number; rows?: number; problems?: number; skipped?: number }

/** EMA / PMDA data loading (the FDA workspace keeps its openFDA sync card). */
export function RegSyncCard({ overview, isAdmin, onDone }: { overview?: FdaOverview; isAdmin: boolean; onDone: () => void }) {
  const R = useRegulator();
  const [running, setRunning] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const last = overview?.last_sync;

  const finish = (acc: { new: number; updated: number; unchanged: number }) =>
    toast.success(`${R.short} import finished: ${number(acc.new)} new, ${number(acc.updated)} updated, ${number(acc.unchanged)} unchanged. India (CDSCO) check updated.`);

  const emaSync = async () => {
    setRunning("Downloading the EMA medicines file…");
    try { finish(await api.post<ImportResult>("/reg/ema/sync")); }
    catch (e) { toast.error(e instanceof Error ? e.message : "EMA import failed"); }
    finally { setRunning(null); onDone(); }
  };

  const upload = async (file: File) => {
    const acc = { new: 0, updated: 0, unchanged: 0 };
    try {
      if (R.code === "EMA") {
        setRunning("Reading the EMA file…");
        finish(await api.upload<ImportResult>("/reg/ema/upload", file));
        return;
      }
      let start = 2;
      let runId: string | undefined;
      for (let i = 0; i < 40; i++) {
        setRunning(`Reading the PMDA list… page ${start} ${runId ? "" : "(first pages)"}`);
        const r = await api.upload<ImportResult>("/reg/pmda/upload", file, { start, run_id: runId });
        runId = r.run_id;
        acc.new += r.new; acc.updated += r.updated; acc.unchanged += r.unchanged;
        setRunning(`Reading the PMDA list… page ${r.next} of ${r.pages} · ${number(acc.new + acc.updated + acc.unchanged)} approvals read`);
        onDone();
        if (r.done) { finish(acc); break; }
        start = r.next ?? start + 30;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${R.short} import failed`);
    } finally {
      setRunning(null);
      onDone();
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ema = R.code === "EMA";
  return (
    <Card>
      <CardHeader
        title={`${R.short} drug data`}
        description={ema
          ? "EU centrally authorised human medicines from the official EMA medicines file (updated nightly by EMA). Updates existing records; never duplicates."
          : "Medicines approved in Japan from PMDA's English 'List of Approved Products' (new approvals and partial changes). PMDA does not allow automated downloads, so download the PDF from PMDA and upload it here."}
        action={isAdmin && (
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept={ema ? ".xlsx" : ".pdf"} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {ema && (
              <Button size="sm" className="whitespace-nowrap" disabled={!!running} onClick={emaSync}>
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Sync from EMA
              </Button>
            )}
            <Button size="sm" className="whitespace-nowrap" variant={ema ? "outline" : "primary"} disabled={!!running} onClick={() => fileRef.current?.click()}>
              {running && !ema ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{ema ? "Upload EMA file" : "Upload PMDA list (PDF)"}
            </Button>
          </div>
        )} />
      <CardBody className="grid grid-cols-2 gap-4 text-sm md:grid-cols-6">
        <Info label="Last import" value={last ? formatDateTime(last.finished_at || last.started_at) : "Never"} />
        <Info label="Status" value={last ? <Badge tone={statusTone(last.status)}>{last.status === "RUNNING" ? (running ? "Running" : "Unfinished") : last.status}</Badge> : "—"} />
        <Info label="Records" value={number(overview?.total_all)} />
        <Info label="New (last import)" value={number(last?.new_count)} />
        <Info label="Updated" value={number(last?.updated_count)} />
        <Info label="Unchanged" value={number(last?.unchanged_count)} />
      </CardBody>
      {running && <div className="border-t border-line px-5 py-2.5 text-xs text-ink-soft"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{running} Keep this tab open.</div>}
      {!running && last?.errors?.length ? (
        <details className="border-t border-line px-5 py-2 text-xs text-amber-800">
          <summary className="cursor-pointer">{last.errors.length} row(s) could not be read and were skipped</summary>
          {last.errors.slice(0, 20).map((e) => <p key={e}>{e}</p>)}
        </details>
      ) : null}
      <div className="border-t border-line px-5 py-2 text-[11px] text-ink-soft">
        {ema ? <>Source: European Medicines Agency (EMA) — <a className="underline" href="https://www.ema.europa.eu/en/medicines/download-medicine-data" target="_blank" rel="noreferrer">download medicine data</a>. Reuse permitted with acknowledgement. EU authorisation is not proof of marketing in every EU country.</>
          : <>Source: PMDA — <a className="underline" href="https://www.pmda.go.jp/english/review-services/reviews/approved-information/drugs/0002.html" target="_blank" rel="noreferrer">List of Approved Products</a> (Public Data License 1.0; table extracted and edited by Ikris). Indication text is PMDA&apos;s approval note.</>}
      </div>
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
