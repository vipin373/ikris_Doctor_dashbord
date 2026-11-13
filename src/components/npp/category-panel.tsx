"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CATEGORY_KEYS, CATEGORY_META, CategoryBadge, catKey, invalidateCategoryData, type CategoryKey } from "@/components/npp/shared";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";

const SOURCE: Record<string, string> = { MANUAL: "Manual", DRAG_DROP: "Drag & drop", BULK: "Bulk", CSV_IMPORT: "File import", SHEET_IMPORT: "Google Sheet", API: "API" };

/** Category control on an NPP doctor's profile: set, change or clear; full change history. */
export function CategoryPanel({ doctorId, category }: { doctorId: string; category: string | null }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const canEdit = !!me && (me.role === "ADMIN" || me.role === "NPP");
  const history = useQuery({
    queryKey: ["npp-cat-history", doctorId],
    queryFn: () => api.get<{ id: number; previous_category: string | null; new_category: string | null; source: string; changed_by_email: string | null; created_at: string }[]>(
      "/npp/categories/history", { doctor_id: doctorId, limit: 20 }),
  });
  const set = useMutation({
    mutationFn: (k: CategoryKey) => api.post<{ updated: number }>("/npp/categories/assign", { doctor_ids: [doctorId], category: k === "UNASSIGNED" ? null : k, source: "MANUAL" }),
    onSuccess: (_r, k) => { toast.success(k === "UNASSIGNED" ? "Category cleared" : `Saved as ${CATEGORY_META[k].label}`); invalidateCategoryData(qc); },
    onError: (e: Error) => toast.error(`Not saved: ${e.message}`),
  });
  const current = catKey(category);
  return (
    <Card>
      <CardHeader title="Doctor category" description="A, B, C or blank. Set by people only." action={<Link href="/npp/categories" className="text-xs font-semibold text-sage-700 hover:underline">Board →</Link>} />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2"><CategoryBadge category={category} className="text-xs" />{set.isPending && <Loader2 className="h-4 w-4 animate-spin text-glow-500" />}</div>
        {canEdit && (
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Set category">
            {CATEGORY_KEYS.map((k) => (
              <button key={k} disabled={set.isPending || k === current} onClick={() => set.mutate(k)}
                className={cn("rounded-lg border px-1 py-1.5 text-[11px] font-semibold transition-all disabled:cursor-default",
                  k === current ? cn("ring-1 ring-inset", CATEGORY_META[k].badge) : "border-line bg-white text-ink-muted hover:border-sage-300 hover:text-ink")}>
                {k === "UNASSIGNED" ? "Clear" : k}
              </button>
            ))}
          </div>
        )}
        {(history.data?.length ?? 0) > 0 && (
          <ol className="space-y-1.5 border-t border-line/70 pt-2.5 text-[11px]">
            {history.data!.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-1 text-ink-soft">
                <CategoryBadge category={h.previous_category} /> → <CategoryBadge category={h.new_category} />
                <span>{SOURCE[h.source] ?? h.source} · {h.changed_by_email ?? "sheet sync"} · {formatDateTime(h.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
