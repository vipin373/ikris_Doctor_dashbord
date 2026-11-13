"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Pill } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { api } from "@/lib/api";

interface Item { id: string; basis: string | null; created_by: string | null; drug: { id: string; generic_name: string; therapeutic_area: string | null } | null }

/** Medicines a person has confirmed as relevant to this doctor (Doctor–Drug Mapping). */
export function DoctorMedicines({ doctorId }: { doctorId: string }) {
  const q = useQuery({ queryKey: ["doctor-medicines", doctorId], queryFn: () => api.get<{ items: Item[] }>(`/drug-intel/doctors/${doctorId}/drugs`) });
  const items = q.data?.items ?? [];
  return (
    <Card>
      <CardHeader title="Mapped medicines" description="Confirmed relevance, not prescribing data" action={<Link href="/drug-intel/mapping" className="text-xs font-semibold text-sage-700 hover:underline">Map →</Link>} />
      <CardBody className="space-y-1.5">
        {q.isLoading ? <p className="text-xs text-ink-soft">Loading…</p> : items.length === 0 ? <p className="text-xs text-ink-soft">No medicines mapped yet.</p> : items.map((m) => m.drug && (
          <Link key={m.id} href={`/drug-intel/drugs/${m.drug.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-sage-50">
            <Pill className="h-3.5 w-3.5 text-sage-600" /><span className="font-medium">{m.drug.generic_name}</span>
            <span className="ml-auto text-[11px] text-ink-soft">{m.drug.therapeutic_area ?? ""}</span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
