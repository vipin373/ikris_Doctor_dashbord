"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Facets } from "@/lib/types";
import { cn, number } from "@/lib/utils";

// ------------------------------------------------------------------ categories
export type CategoryKey = "A" | "B" | "C" | "UNASSIGNED";
export const CATEGORY_KEYS: CategoryKey[] = ["A", "B", "C", "UNASSIGNED"];

/** Subtle, distinct identity per category; Unassigned is neutral. */
export const CATEGORY_META: Record<CategoryKey, { label: string; short: string; badge: string; dot: string; ring: string; head: string; bar: string }> = {
  A: { label: "Category A", short: "A", badge: "bg-sage-50 text-sage-800 ring-sage-300", dot: "bg-sage-500", ring: "ring-sage-300", head: "from-sage-100 to-sage-50 text-sage-800", bar: "#6F9155" },
  B: { label: "Category B", short: "B", badge: "bg-glow-50 text-glow-800 ring-glow-300", dot: "bg-glow-500", ring: "ring-glow-300", head: "from-glow-100 to-glow-50 text-glow-800", bar: "#D5851F" },
  C: { label: "Category C", short: "C", badge: "bg-walnut-50 text-walnut-700 ring-walnut-300", dot: "bg-walnut-500", ring: "ring-walnut-300", head: "from-walnut-100 to-walnut-50 text-walnut-800", bar: "#7C5A40" },
  UNASSIGNED: { label: "Unassigned", short: "—", badge: "bg-slate-50 text-slate-600 ring-slate-200", dot: "bg-slate-300", ring: "ring-slate-200", head: "from-slate-100 to-slate-50 text-slate-700", bar: "#ACA08C" },
};

export function catKey(c?: string | null): CategoryKey {
  return c === "A" || c === "B" || c === "C" ? c : "UNASSIGNED";
}

export function CategoryBadge({ category, className }: { category?: string | null; className?: string }) {
  const k = catKey(category);
  const m = CATEGORY_META[k];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {k === "UNASSIGNED" ? "Unassigned" : m.label}
    </span>
  );
}

export interface CategoryStats {
  doctors: number; valid_email: number; with_whatsapp: number; emails_sent: number; whatsapp_sent: number;
  contacted: number; email_replies: number; whatsapp_replies: number; failed: number; replied_doctors: number;
}
export type CategorySummary = Record<CategoryKey, CategoryStats>;

export function useCategorySummary(enabled = true) {
  return useQuery({ queryKey: ["npp-category-summary"], queryFn: () => api.get<CategorySummary>("/npp/categories/summary"), enabled });
}

/** Four interactive category cards from live data. */
export function CategoryCards({ hrefFor }: { hrefFor: (k: CategoryKey) => string }) {
  const { data, isLoading } = useCategorySummary();
  return (
    <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CATEGORY_KEYS.map((k) => {
        const m = CATEGORY_META[k];
        const s = data?.[k];
        return (
          <Link key={k} href={hrefFor(k)}
            className="group surface-3d relative block overflow-hidden rounded-card border border-line/80 bg-white shadow-card focus-visible:ring-2 focus-visible:ring-glow-400">
            <span className="sheen" aria-hidden />
            <div className={cn("flex items-center justify-between bg-gradient-to-r px-4 py-2.5", m.head)}>
              <span className="text-sm font-bold">{m.label}</span>
              <span className="text-[11px] font-medium opacity-80 transition-transform group-hover:translate-x-0.5">Open list →</span>
            </div>
            <div className="p-4">
              {isLoading || !s ? <Skeleton className="h-20" /> : (
                <>
                  <p className="text-[28px] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums">{number(s.doctors)}</p>
                  <p className="mt-1 text-xs text-ink-soft">doctors</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
                    <Stat label="Valid email" v={s.valid_email} />
                    <Stat label="WhatsApp no." v={s.with_whatsapp} />
                    <Stat label="Emails sent" v={s.emails_sent} />
                    <Stat label="Email replies" v={s.email_replies} />
                    <Stat label="WhatsApp sent" v={s.whatsapp_sent} />
                    <Stat label="WhatsApp replies" v={s.whatsapp_replies} />
                  </dl>
                </>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-line/70 pb-1">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{number(v)}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ selection model
/** Either an explicit list of doctor ids, or "every doctor matching these filters". */
export type Selection = { doctor_ids: string[]; filters?: undefined } | { doctor_ids?: undefined; filters: Record<string, string | boolean> };

export interface AssignResult { requested: number; matched: number; updated: number; unchanged: number; not_found: number }

/** Bulk category change with the required confirmation step (counts come from the server). */
export function AssignCategoryDialog({
  open, onOpenChange, selection, initialCategory = "A", source = "BULK", onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selection: Selection | null;
  initialCategory?: "A" | "B" | "C" | "CLEAR";
  source?: "MANUAL" | "BULK" | "DRAG_DROP";
  onDone?: (r: AssignResult) => void;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = React.useState<"A" | "B" | "C" | "CLEAR">(initialCategory);
  React.useEffect(() => { if (open) setTarget(initialCategory); }, [open, initialCategory]);
  const preview = useQuery({
    queryKey: ["npp-cat-preview", selection],
    queryFn: () => api.post<{ total: number; requested: number; distribution: Record<CategoryKey, number> }>("/npp/categories/preview", selection),
    enabled: open && !!selection,
  });
  const newKey: CategoryKey = target === "CLEAR" ? "UNASSIGNED" : target;
  const toUpdate = preview.data ? preview.data.total - (preview.data.distribution[newKey] ?? 0) : 0;
  const save = useMutation({
    mutationFn: () => api.post<AssignResult>("/npp/categories/assign", { ...selection, category: target === "CLEAR" ? null : target, source }),
    onSuccess: (r) => {
      toast.success(`${number(r.updated)} doctor${r.updated === 1 ? "" : "s"} updated` +
        (r.unchanged ? ` · ${number(r.unchanged)} already ${target === "CLEAR" ? "unassigned" : "in Category " + target}` : "") +
        (r.not_found ? ` · ${number(r.not_found)} not updated (not NPP or no access)` : ""));
      invalidateCategoryData(qc);
      onDone?.(r);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(`Not saved: ${e.message}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change doctor category"
      description="Nothing is saved until you confirm. Each change is logged."
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || preview.isLoading || !preview.data?.total || toUpdate === 0}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm · update {number(toUpdate)}
        </Button>
      </>}>
      <div className="space-y-4 text-sm">
        <div>
          <Label>New category</Label>
          <div className="mt-1.5 grid grid-cols-4 gap-2">
            {(["A", "B", "C", "CLEAR"] as const).map((c) => (
              <button key={c} onClick={() => setTarget(c)}
                className={cn("rounded-xl border px-2 py-2 text-xs font-semibold transition-all",
                  target === c ? "border-glow-400 bg-glow-50 text-glow-800 shadow-glow" : "border-line bg-white text-ink-muted hover:border-sage-300")}>
                {c === "CLEAR" ? "Clear (Unassigned)" : `Category ${c}`}
              </button>
            ))}
          </div>
        </div>
        {preview.isLoading ? <Skeleton className="h-24" /> : preview.error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-red-700">{(preview.error as Error).message}</p>
        ) : preview.data && (
          <div className="rounded-xl border border-line bg-cream/40 p-3">
            <p className="text-xs text-ink-soft">Total selected doctors</p>
            <p className="text-xl font-bold tabular-nums">{number(preview.data.total)}</p>
            <p className="mt-2 text-xs text-ink-soft">Current categories</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {CATEGORY_KEYS.map((k) => (
                <span key={k} className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", CATEGORY_META[k].badge)}>
                  {CATEGORY_META[k].label}: {number(preview.data!.distribution[k])}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs">
              New category: <b>{target === "CLEAR" ? "Unassigned (blank)" : `Category ${target}`}</b> · Records to update: <b>{number(toUpdate)}</b>
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function invalidateCategoryData(qc: ReturnType<typeof useQueryClient>) {
  ["npp-category-summary", "npp-board", "doctors", "doctor", "npp-cat-history", "npp-groups", "npp-group-members", "npp-analytics", "dashboard"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ------------------------------------------------------------------ groups
export interface GroupStat {
  id: string; name: string; description: string | null; filters: Record<string, unknown>;
  members: number; with_email: number; with_whatsapp: number; cat_a: number; cat_b: number; cat_c: number; unassigned: number;
  created_at: string; updated_at: string;
}

export function useGroups() {
  return useQuery({ queryKey: ["npp-groups"], queryFn: () => api.get<GroupStat[]>("/npp/groups") });
}

/** Add the selected doctors to an existing group or a new one. */
export function AddToGroupDialog({ open, onOpenChange, selection }: { open: boolean; onOpenChange: (v: boolean) => void; selection: Selection | null }) {
  const qc = useQueryClient();
  const { data: groups } = useGroups();
  const [groupId, setGroupId] = React.useState("");
  const [newName, setNewName] = React.useState("");
  React.useEffect(() => { if (open) { setGroupId(""); setNewName(""); } }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      let id = groupId;
      if (!id) {
        const g = await api.post<{ id: string }>("/npp/groups", { name: newName.trim(), add_matching: false });
        id = g.id;
      }
      return api.post<{ selected: number; added: number; already_in_group: number }>(`/npp/groups/${id}/members`, selection);
    },
    onSuccess: (r) => {
      toast.success(`${number(r.added)} added to the group` + (r.already_in_group ? ` · ${number(r.already_in_group)} were already in it` : ""));
      qc.invalidateQueries({ queryKey: ["npp-groups"] });
      qc.invalidateQueries({ queryKey: ["npp-group-members"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add to group"
      description="Groups are separate from categories: a doctor can be in many groups."
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || (!groupId && !newName.trim())}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add
        </Button>
      </>}>
      <div className="space-y-3 text-sm">
        <div>
          <Label>Existing group</Label>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="mt-1">
            <option value="">— Create a new group —</option>
            {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name} ({number(g.members)})</option>)}
          </Select>
        </div>
        {!groupId && (
          <div>
            <Label>New group name</Label>
            <Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Category A – Oncology – Delhi" maxLength={120} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ filters form (groups, outreach)
export type CrmFilters = Partial<Record<"category" | "sub_department" | "specialty" | "city" | "state" | "institute" | "has_email" | "has_whatsapp" | "q", string>>;

export function CrmFilterFields({ value, onChange, showCategory = true }: { value: CrmFilters; onChange: (v: CrmFilters) => void; showCategory?: boolean }) {
  const { data: facets } = useQuery({ queryKey: ["facets"], queryFn: () => api.get<Facets>("/doctors/facets") });
  const set = (k: keyof CrmFilters, v: string) => onChange({ ...value, [k]: v || undefined });
  const subs = (facets?.sub_departments ?? []).filter((s) => s.department === "NPP");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {showCategory && (
        <Select value={value.category ?? ""} onChange={(e) => set("category", e.target.value)} aria-label="Category">
          <option value="">Any category</option>
          <option value="A">Category A</option><option value="B">Category B</option><option value="C">Category C</option>
          <option value="none">Unassigned</option>
        </Select>
      )}
      <Select value={value.sub_department ?? ""} onChange={(e) => set("sub_department", e.target.value)} aria-label="Specialization">
        <option value="">Any specialization</option>
        {subs.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
      </Select>
      <Select value={value.city ?? ""} onChange={(e) => set("city", e.target.value)} aria-label="City">
        <option value="">Any city</option>
        {(facets?.cities ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
      <Input value={value.state ?? ""} onChange={(e) => set("state", e.target.value)} placeholder="State (exact, optional)" aria-label="State" />
      <Input value={value.institute ?? ""} onChange={(e) => set("institute", e.target.value)} placeholder="Hospital contains…" aria-label="Hospital" />
      <Input value={value.q ?? ""} onChange={(e) => set("q", e.target.value)} placeholder="Keyword (name, email…)" aria-label="Keyword" />
      <Select value={value.has_email ?? ""} onChange={(e) => set("has_email", e.target.value)} aria-label="Email">
        <option value="">Email: any</option><option value="true">Has valid email</option><option value="false">No valid email</option>
      </Select>
      <Select value={value.has_whatsapp ?? ""} onChange={(e) => set("has_whatsapp", e.target.value)} aria-label="WhatsApp">
        <option value="">WhatsApp: any</option><option value="true">Has WhatsApp number</option><option value="false">No WhatsApp number</option>
      </Select>
    </div>
  );
}

/** Convert UI filter strings to the API's typed filter object. */
export function toApiFilters(f: CrmFilters): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  Object.entries(f).forEach(([k, v]) => {
    if (v === undefined || v === "") return;
    out[k] = k === "has_email" || k === "has_whatsapp" ? v === "true" : v;
  });
  return out;
}

export { Textarea };

/** Hand a doctor selection to the Outreach page (ids can be too many for a URL). */
export function saveOutreachSelection(ids: string[]) {
  try { window.sessionStorage.setItem("npp.outreach.selected", JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

export function takeOutreachSelection(): string[] {
  try {
    const v = window.sessionStorage.getItem("npp.outreach.selected");
    window.sessionStorage.removeItem("npp.outreach.selected");
    return v ? (JSON.parse(v) as string[]) : [];
  } catch { return []; }
}
