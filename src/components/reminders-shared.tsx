"use client";

import { Badge } from "@/components/ui/badge";
import { AREA_LABEL, AREA_TONE, fdaDate } from "@/lib/fda";
import { cn } from "@/lib/utils";

export interface FollowUp {
  doctor_id: string; doctor_name: string; department: "NPP" | "RARE_DISEASES"; sub_department: string | null; institute: string | null;
  email: string | null; phone: string | null; must_see: boolean; last_sent_at: string | null; last_campaign: string | null;
  interval_days: number; due_date: string | null; pending: string[] | null; failed: string[] | null;
  days_overdue: number | null; bucket: "overdue" | "today" | "week" | "later" | "failed";
}
export interface NewMolecule {
  id: string; drug_name: string; active_ingredient: string | null; manufacturer: string | null; department: string | null;
  therapeutic_areas: string[]; approval_date: string; india_status: string | null; created_at: string; application_number: string;
}
export interface RemindersData {
  today: string;
  follow_ups: FollowUp[];
  fda_eligible: { id: string; doctor_name: string; department: string; sub_department: string | null; institute: string | null; must_see: boolean; last_message_sent_at: string; next_eligible_at: string | null }[];
  important_dates: { doctor_id: string; doctor_name: string; kind: "birthday" | "anniversary"; next_date: string; days_until: number; department: string; sub_department: string | null }[];
  new_molecules: NewMolecule[];
  settings: { npp_days: number; rare_days: number };
}

export function daysAgo(today: string, iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(`${today}T00:00:00+05:30`).getTime() - new Date(`${iso.slice(0, 10)}T00:00:00+05:30`).getTime()) / 86400000);
}

export function MoleculeList({ items, today }: { items: NewMolecule[]; today: string }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((m) => {
        const age = daysAgo(today, m.approval_date) ?? 0;
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", age <= 30 ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-800")}>NEW</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{m.drug_name} <span className="font-normal text-ink-soft">({m.active_ingredient})</span></p>
              <p className="text-[11px] text-ink-soft">{m.manufacturer} · {m.application_number}</p>
            </div>
            <div className="flex gap-1">{(m.therapeutic_areas.length ? m.therapeutic_areas : [m.department ?? "NEEDS_REVIEW"]).map((a) => <Badge key={a} tone={AREA_TONE[a] ?? "neutral"}>{AREA_LABEL[a] ?? a}</Badge>)}</div>
            <span className="w-32 text-right text-xs text-ink-muted">FDA approved {fdaDate(m.approval_date)}</span>
          </li>
        );
      })}
    </ul>
  );
}

