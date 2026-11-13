"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Columns3, FilePlus2, History, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { CountryMatrix, RuleNotice, SourceLink, StatusBadge, VerifyDialog, useMeta, type MatrixCell } from "@/components/drug-intel/shared";
import { DoctorMappingPanel } from "@/components/drug-intel/doctor-mapping";
import { EditDrugDialog, type DrugRecord } from "@/components/drug-intel/drug-form";
import { api } from "@/lib/api";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

interface Detail {
  drug: DrugRecord; matrix: MatrixCell[]; is_admin: boolean; mapped_doctors: number; suggested_specialties: string[];
  indications: { id: number; indication: string; country: string; approval_status: string | null; approval_date: string | null; source_url: string | null; disease_category: string | null; verification_status: string }[];
  history: { id: string; country: string | null; previous_status: string | null; new_status: string | null; effective_date: string | null; description: string | null; changed_by: string | null; updated_on: string; source_url: string | null }[];
  documents: { country: string; type: string; label: string; url: string }[];
  requests: { id: string; request_status: string; required_country: string | null; request_date: string }[];
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value || <span className="text-ink-soft">Not stated in source</span>}</dd>
    </div>
  );
}

const TABS = ["Overview", "Countries", "Indications", "Documents", "Doctors", "History"] as const;

export default function DrugDetailPage() {
  const { id } = useParams<{ id: string }>();
  const meta = useMeta();
  const q = useQuery({ queryKey: ["drug-intel-drug", id], queryFn: () => api.get<Detail>(`/drug-intel/drugs/${id}`) });
  const [tab, setTab] = React.useState<(typeof TABS)[number]>("Overview");
  const [edit, setEdit] = React.useState(false);
  const [addCountry, setAddCountry] = React.useState(false);
  React.useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h === "#source") setTab("Documents");
    if (h === "#doctors") setTab("Doctors");
  }, []);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { drug, matrix } = q.data;
  const eu = matrix.find((m) => m.country === "EU");

  return (
    <div>
      <PageHeader
        breadcrumb={<><Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link> / <Link href="/drug-intel/drugs" className="hover:underline">Drug database</Link></>}
        title={drug.generic_name}
        description={<>{drug.id}{drug.brand_names.length > 0 && <> · {drug.brand_names.slice(0, 6).join(", ")}{drug.brand_names.length > 6 && ` +${drug.brand_names.length - 6} more`}</>}</>}
        actions={<>
          <Link href={`/drug-intel/compare?ids=${drug.id}`}><Button size="sm" variant="outline"><Columns3 className="h-3.5 w-3.5" />Compare</Button></Link>
          <Link href={`/drug-intel/requests?new=1&drug=${drug.id}`}><Button size="sm" variant="outline"><FilePlus2 className="h-3.5 w-3.5" />Add to NPP request</Button></Link>
          {q.data.is_admin && <Button size="sm" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
        </>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {matrix.filter((m) => ["US", "EU", "GB", "JP"].includes(m.country)).map((m) => (
          <div key={m.country} className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 shadow-card">
            <span className="text-xs font-semibold text-ink-muted">{m.country === "EU" ? "EU" : m.name}</span><StatusBadge status={m.status} />
            {m.record?.approval_date && <span className="text-[11px] text-ink-soft">{formatDate(m.record.approval_date)}</span>}
          </div>
        ))}
        {drug.is_oncology && <span className="self-center rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Oncology</span>}
        {drug.is_rare && <span className="self-center rounded-md bg-walnut-50 px-2 py-1 text-xs font-semibold text-walnut-700">Rare disease</span>}
        <span className="self-center rounded-md bg-cream px-2 py-1 text-xs font-semibold text-walnut-800">{drug.orphan_label}</span>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors", tab === t ? "border-glow-500 text-walnut-800" : "border-transparent text-ink-soft hover:text-ink")}>
            {t}{t === "Doctors" && q.data.mapped_doctors > 0 && ` (${q.data.mapped_doctors})`}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="A. Basic drug information" />
            <CardBody>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Generic name" value={drug.generic_name} />
                <Field label="Brand names" value={drug.brand_names.join(", ")} />
                <Field label="Active ingredient" value={drug.active_ingredient} />
                <Field label="KEGG ID" value={drug.kegg_drug_id} />
                <Field label="Drug class" value={drug.drug_class} />
                <Field label="ATC code" value={drug.atc_code} />
                <Field label="Manufacturer" value={drug.manufacturer} />
                <Field label="Marketing authorisation holder" value={drug.mah} />
                <Field label="Dosage form" value={drug.dosage_form} />
                <Field label="Strength" value={drug.strength} />
                <Field label="Route" value={drug.route} />
                <Field label="Drug type" value={drug.drug_type} />
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="B. Therapeutic information" />
            <CardBody className="space-y-3">
              <Field label="Therapeutic area" value={drug.therapeutic_area} />
              <Field label="Disease categories" value={drug.sub_therapeutic_area} />
              <Field label="Rare disease relevance" value={drug.is_rare ? "Yes (orphan status or rare-disease indication)" : "Not identified"} />
              <Field label="Orphan designation" value={drug.orphan_label} />
              <Field label="Suggested doctor specialties" value={q.data.suggested_specialties.join(", ")} />
              <Field label="Record status" value={<>{drug.verification_status}{drug.locked && " · protected from automatic imports"}</>} />
            </CardBody>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader title="Indication" description="As stated in the first source record; see the Indications tab for each country" />
            <CardBody><p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{drug.indication || "No indication text in the imported source. Check the product label."}</p></CardBody>
          </Card>
          <div className="lg:col-span-3"><RuleNotice /></div>
        </div>
      )}

      {tab === "Countries" && (
        <Card>
          <CardHeader title="C. Country approval matrix" description="One record per jurisdiction. Countries without a record show 'Not Verified'."
            action={q.data.is_admin ? <Button size="sm" variant="outline" onClick={() => setAddCountry(true)}><Plus className="h-3.5 w-3.5" />Add country</Button> : undefined} />
          <CardBody>
            <CountryMatrix cells={matrix} drugId={drug.id} isAdmin={q.data.is_admin} />
            {eu?.has_record && <p className="mt-2 text-[11px] text-ink-soft">EU data: Source: European Medicines Agency (EMA). An EU centralised authorisation is not proof that the medicine is marketed in every EU country. UK records are kept separately.</p>}
          </CardBody>
        </Card>
      )}

      {tab === "Indications" && (
        <Card>
          <CardHeader title="Approved indications by country" />
          <CardBody className="space-y-3">
            {q.data.indications.length === 0 && <p className="text-sm text-ink-soft">No indication records yet.</p>}
            {q.data.indications.map((i) => (
              <div key={i.id} className="rounded-xl border border-line p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <b>{i.country}</b><StatusBadge small status={i.approval_status} />{i.approval_date && <span className="text-ink-soft">{formatDate(i.approval_date)}</span>}
                  <SourceLink href={i.source_url} />
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{i.indication}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {tab === "Documents" && (
        <Card>
          <CardHeader title="D. Regulatory documents" description="Only links that exist in the verified source records are shown." />
          <CardBody>
            {q.data.documents.length === 0 ? <p className="text-sm text-ink-soft">No documents linked yet.</p> : (
              <ul className="divide-y divide-line">
                {q.data.documents.map((d) => (
                  <li key={d.url + d.type} className="flex items-center justify-between py-2 text-sm">
                    <span><b>{d.type}</b> — {d.label}</span><SourceLink href={d.url}>Open</SourceLink>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "Doctors" && (
        <Card><CardHeader title="Doctor–drug mapping" description="Confirm which doctors are relevant to this medicine." /><CardBody><DoctorMappingPanel drugId={drug.id} drugName={drug.generic_name} /></CardBody></Card>
      )}

      {tab === "History" && (
        <Card>
          <CardHeader title="Regulatory history" description="Every status or date change, kept permanently" action={<History className="h-4 w-4 text-ink-soft" />} />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2">When</th><th className="px-2 py-2">Country</th><th className="px-2 py-2">Change</th><th className="px-2 py-2">Effective</th><th className="px-4 py-2">By</th>
              </tr></thead>
              <tbody>
                {q.data.history.map((h) => (
                  <tr key={h.id} className="border-t border-line align-top">
                    <td className="px-4 py-2 text-xs text-ink-soft">{formatDateTime(h.updated_on)}</td>
                    <td className="px-2 py-2 text-xs font-semibold">{h.country}</td>
                    <td className="px-2 py-2 text-xs">
                      {h.previous_status ? <><StatusBadge small status={h.previous_status} /> → </> : null}<StatusBadge small status={h.new_status} />
                      <p className="mt-0.5 text-ink-soft">{h.description}</p>
                    </td>
                    <td className="px-2 py-2 text-xs">{h.effective_date ? formatDate(h.effective_date) : "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{h.changed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {q.data.requests.length > 0 && (
        <p className="mt-4 text-xs text-ink-soft">NPP requests for this medicine: {q.data.requests.map((r) => <Link key={r.id} href={`/drug-intel/requests?open=${r.id}`} className="mr-2 font-semibold text-sage-700 hover:underline">{r.id} ({r.request_status})</Link>)}</p>
      )}
      {edit && <EditDrugDialog open onOpenChange={setEdit} drug={drug} />}
      {addCountry && <VerifyDialog open onOpenChange={setAddCountry} drugId={drug.id} countries={meta.data?.countries.map((c) => ({ code: c.code, name: c.name })) ?? []} />}
    </div>
  );
}
