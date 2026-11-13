"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Skeleton } from "@/components/ui/misc";
import { DrugPicker, StatusBadge, type DrugRow } from "@/components/drug-intel/shared";
import { DoctorMappingPanel } from "@/components/drug-intel/doctor-mapping";
import { api } from "@/lib/api";

function MappingInner() {
  const params = useSearchParams();
  const router = useRouter();
  const drugId = params.get("drug");
  const drug = useQuery({
    queryKey: ["drug-intel-drug", drugId],
    queryFn: () => api.get<{ drug: { id: string; generic_name: string } ; matrix: { country: string; status: string }[] }>(`/drug-intel/drugs/${drugId}`),
    enabled: !!drugId,
  });
  const mapped = useQuery({
    queryKey: ["drug-intel-mapped-list"],
    queryFn: () => api.get<{ items: DrugRow[]; total: number }>("/drug-intel/drugs", { preset: "mapped", sort: "name", page_size: 100 }),
  });
  const pick = (d: DrugRow | null) => router.replace(d ? `/drug-intel/mapping?drug=${d.id}` : "/drug-intel/mapping");
  const ids = (mapped.data?.items ?? []).map((d) => d.id);

  return (
    <div>
      <PageHeader title="Doctor–Drug Mapping" breadcrumb={<Link href="/drug-intel" className="hover:underline">International Drug Intelligence</Link>}
        description="Link medicines to relevant doctors. Suggestions come from specialty and always need a person to confirm." />
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="1. Choose a medicine" />
            <CardBody>
              <DrugPicker value={drug.data ? drug.data.drug : null} onChange={pick} />
              {drug.data && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {drug.data.matrix.filter((m) => ["US", "EU", "JP"].includes(m.country)).map((m) => (
                    <span key={m.country} className="inline-flex items-center gap-1 text-[11px]">{m.country}<StatusBadge small status={m.status} /></span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Medicines with mapped doctors" description={`${mapped.data?.total ?? 0} medicines`}
              action={ids.length > 0 ? <Button size="sm" variant="outline" onClick={() => api.download("/drug-intel/mappings/export", { drug_ids: ids.slice(0, 50).join(",") }, "doctors-by-medicine.csv")}><Download className="h-3.5 w-3.5" />Export</Button> : undefined} />
            <CardBody className="max-h-[420px] space-y-1 overflow-y-auto">
              {mapped.isLoading && <Skeleton className="h-24" />}
              {mapped.data?.items.length === 0 && <p className="text-sm text-ink-soft">None yet.</p>}
              {mapped.data?.items.map((d) => (
                <button key={d.id} onClick={() => pick(d)} className="flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sage-50">
                  <span className="font-medium">{d.generic_name}</span><span className="text-xs text-ink-soft">{d.mapped_doctors} doctors</span>
                </button>
              ))}
            </CardBody>
          </Card>
        </div>
        <Card className="min-w-0">
          <CardHeader title={drug.data ? `2. Doctors for ${drug.data.drug.generic_name}` : "2. Doctors"} />
          <CardBody>
            {drugId ? <DoctorMappingPanel drugId={drugId} drugName={drug.data?.drug.generic_name ?? drugId} /> :
              <p className="text-sm text-ink-soft">Choose a medicine to see suggested and mapped doctors.</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function MappingPage() {
  return <React.Suspense fallback={<Skeleton className="h-96" />}><MappingInner /></React.Suspense>;
}
