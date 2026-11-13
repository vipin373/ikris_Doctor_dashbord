"use client";

import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, GripVertical, History, Loader2, Mail, MessageCircle, Search, Upload, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  AddToGroupDialog, AssignCategoryDialog, CATEGORY_KEYS, CATEGORY_META, CategoryBadge, CategoryCards, catKey,
  invalidateCategoryData, saveOutreachSelection, type CategoryKey, type Selection,
} from "@/components/npp/shared";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Dialog, EmptyState, PageHeader, Skeleton, Switch } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Facets } from "@/lib/types";
import { cn, formatDateTime, number } from "@/lib/utils";

interface BoardDoctor {
  id: string; doctor_name: string; specialty: string | null; sub_department: string | null; institute: string | null;
  city: string | null; state: string | null; country: string | null; email: string | null; email_norm: string | null;
  whatsapp_number: string | null; category: string | null;
}
interface BoardPage { items: BoardDoctor[]; total: number; page: number; page_size: number }

const DRAG_TYPE = "application/x-ikris-doctors";

export default function CategoryBoardPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [sub, setSub] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = React.useState<CategoryKey | null>(null);
  const [bulk, setBulk] = React.useState<{ selection: Selection; target: "A" | "B" | "C" | "CLEAR" } | null>(null);
  const [groupSel, setGroupSel] = React.useState<Selection | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data: facets } = useQuery({ queryKey: ["facets"], queryFn: () => api.get<Facets>("/doctors/facets") });

  const move = useMutation({
    mutationFn: ({ ids, target }: { ids: string[]; target: CategoryKey }) =>
      api.post<{ updated: number }>("/npp/categories/assign", { doctor_ids: ids, category: target === "UNASSIGNED" ? null : target, source: "DRAG_DROP" }),
    onMutate: ({ ids }) => setPending((p) => new Set([...p, ...ids])),
    onSuccess: (r, { target, ids }) => {
      // shown only after the database confirmed the change
      toast.success(r.updated ? `Moved to ${CATEGORY_META[target].label}` : "Already in that category");
      invalidateCategoryData(qc);
      setSelected((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    },
    onError: (e: Error, vars) => toast.error(`Not moved: ${e.message}`, { action: { label: "Retry", onClick: () => move.mutate(vars) } }),
    onSettled: (_r, _e, { ids }) => setPending((p) => { const n = new Set(p); ids.forEach((i) => n.delete(i)); return n; }),
  });

  if (me && !me.departments.includes("NPP")) {
    return <Card><EmptyState title="No access" description="Category management is for NPP doctors (Admin and NPP users)." /></Card>;
  }

  const onDrop = (target: CategoryKey, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    let ids: string[] = [];
    try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]"); } catch { ids = []; }
    if (!ids.length) return;
    if (ids.length === 1) move.mutate({ ids, target });
    else setBulk({ selection: { doctor_ids: ids }, target: target === "UNASSIGNED" ? "CLEAR" : target });
  };

  const exportCat = (k: CategoryKey | "ALL") =>
    api.download("/doctors/export", { department: "NPP", ...(k === "ALL" ? {} : { category: k === "UNASSIGNED" ? "none" : k }) },
      `npp-${k === "ALL" ? "all" : k === "UNASSIGNED" ? "unassigned" : "category-" + k.toLowerCase()}.csv`)
      .catch((e: Error) => toast.error(e.message));

  return (
    <div>
      <PageHeader
        breadcrumb={<Link href="/npp" className="hover:underline">NPP</Link>}
        title="Doctor Category Management"
        description="Every NPP doctor is in Category A, B or C, or left blank (Unassigned). Categories are only set by people, never automatically."
        actions={<>
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import categories</Button>
          <Select className="w-auto" value="" onChange={(e) => e.target.value && exportCat(e.target.value as CategoryKey | "ALL")} aria-label="Export">
            <option value="">Export…</option>
            <option value="ALL">All NPP doctors</option>
            {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORY_META[k].label}</option>)}
          </Select>
        </>}
      />

      <CategoryCards hrefFor={(k) => `/npp?category=${k === "UNASSIGNED" ? "none" : k}`} />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter this board: name, hospital, city, email…" className="pl-9" aria-label="Filter board" />
        </div>
        <Select className="w-auto" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Specialization">
          <option value="">All specializations</option>
          {(facets?.sub_departments ?? []).filter((s) => s.department === "NPP").map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
        </Select>
        <p className="text-xs text-ink-soft">Drag a card to another column, or tick several and use “Move selected”.</p>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-glow-200 bg-white/95 px-4 py-2.5 shadow-lift backdrop-blur">
          <span className="text-sm font-semibold">{number(selected.size)} selected</span>
          <span className="text-xs text-ink-soft">Move selected to</span>
          {(["A", "B", "C", "CLEAR"] as const).map((t) => (
            <Button key={t} size="sm" variant={t === "CLEAR" ? "outline" : "secondary"} onClick={() => setBulk({ selection: { doctor_ids: [...selected] }, target: t })}>
              {t === "CLEAR" ? "Unassigned" : `Category ${t}`}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setGroupSel({ doctor_ids: [...selected] })}>Add to group</Button>
          <Link href="/npp/outreach" onClick={() => saveOutreachSelection([...selected])}>
            <Button size="sm" variant="outline"><Mail className="h-3.5 w-3.5" /> Email / <MessageCircle className="h-3.5 w-3.5" /> WhatsApp</Button>
          </Link>
          <button className="ml-auto text-xs text-ink-soft hover:text-ink" onClick={() => setSelected(new Set())}><X className="inline h-3.5 w-3.5" /> Clear</button>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {CATEGORY_KEYS.map((k) => (
          <BoardColumn key={k} cat={k} q={dq} sub={sub} selected={selected} pending={pending}
            onToggle={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onMove={(id, target) => move.mutate({ ids: [id], target })}
            dragOver={dragOver === k}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(k); } }}
            onDragLeave={() => setDragOver((d) => (d === k ? null : d))}
            onDrop={(e) => onDrop(k, e)} />
        ))}
      </div>

      <RecentChanges />

      <AssignCategoryDialog open={!!bulk} onOpenChange={(v) => !v && setBulk(null)} selection={bulk?.selection ?? null}
        initialCategory={bulk?.target} source="BULK" onDone={() => setSelected(new Set())} />
      <AddToGroupDialog open={!!groupSel} onOpenChange={(v) => !v && setGroupSel(null)} selection={groupSel} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function BoardColumn({
  cat, q, sub, selected, pending, onToggle, onMove, dragOver, onDragOver, onDragLeave, onDrop,
}: {
  cat: CategoryKey; q: string; sub: string; selected: Set<string>; pending: Set<string>;
  onToggle: (id: string) => void; onMove: (id: string, target: CategoryKey) => void; dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
}) {
  const m = CATEGORY_META[cat];
  const query = useInfiniteQuery({
    queryKey: ["npp-board", cat, q, sub],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<BoardPage>("/npp/categories/board", { category: cat, q: q || undefined, sub_department: sub || undefined, page: pageParam, page_size: 30 }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });
  const items = (query.data?.pages ?? []).flatMap((p) => p.items);
  const total = query.data?.pages[0]?.total ?? 0;
  return (
    <section
      aria-label={m.label}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className={cn("flex max-h-[78vh] min-h-[320px] flex-col rounded-card border bg-cream/40 transition-[box-shadow,border-color,background-color] duration-250",
        dragOver ? cn("border-transparent bg-white shadow-glow ring-2", m.ring) : "border-line/80")}
    >
      <header className={cn("flex items-center justify-between rounded-t-card bg-gradient-to-r px-4 py-3", m.head)}>
        <h2 className="text-sm font-bold">{m.label}</h2>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold tabular-nums">{number(total)}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {query.isLoading ? <Skeleton className="h-28" /> : items.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-ink-soft">{dragOver ? "Drop here" : q || sub ? "No matches" : "No doctors"}</p>
        ) : items.map((d) => (
          <DoctorCard key={d.id} d={d} checked={selected.has(d.id)} busy={pending.has(d.id)} selectedIds={selected}
            onToggle={() => onToggle(d.id)} onMove={(t) => onMove(d.id, t)} />
        ))}
        {query.hasNextPage && (
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Load more (${number(total - items.length)} left)`}
          </Button>
        )}
      </div>
    </section>
  );
}

function DoctorCard({ d, checked, busy, selectedIds, onToggle, onMove }: {
  d: BoardDoctor; checked: boolean; busy: boolean; selectedIds: Set<string>; onToggle: () => void; onMove: (t: CategoryKey) => void;
}) {
  const current = catKey(d.category);
  return (
    <article
      draggable={!busy}
      onDragStart={(e) => {
        const ids = checked && selectedIds.size > 1 ? [...selectedIds] : [d.id];
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn("group relative cursor-grab rounded-xl border bg-white p-3 shadow-card transition-[transform,box-shadow,border-color] duration-250 ease-smooth active:cursor-grabbing",
        "hover:-translate-y-0.5 hover:shadow-lift", checked ? "border-glow-300 ring-1 ring-glow-200" : "border-line/80", busy && "pointer-events-none opacity-50")}
    >
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${d.doctor_name}`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Link href={`/doctors/${d.id}`} className="block truncate text-[13px] font-semibold text-ink hover:text-sage-700 hover:underline">{d.doctor_name}</Link>
          <p className="truncate text-[11px] text-ink-soft">{[d.sub_department || d.specialty, d.institute].filter(Boolean).join(" · ") || "—"}</p>
          <p className="truncate text-[11px] text-ink-soft">{[d.city, d.state, d.country].filter(Boolean).join(", ") || "Location not set"}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <CategoryBadge category={d.category} />
            <span className={cn("rounded px-1 py-0.5", d.email_norm ? "bg-sage-50 text-sage-800" : "bg-slate-100 text-slate-500")} title={d.email ?? ""}>
              {d.email_norm ? "Email" : "No email"}
            </span>
            <span className={cn("rounded px-1 py-0.5", d.whatsapp_number ? "bg-sage-50 text-sage-800" : "bg-slate-100 text-slate-500")} title={d.whatsapp_number ?? ""}>
              {d.whatsapp_number ? "WhatsApp" : "No WhatsApp"}
            </span>
          </div>
        </div>
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-glow-500" /> : <GripVertical className="h-4 w-4 shrink-0 text-ink-soft opacity-40 group-hover:opacity-100" aria-hidden />}
      </div>
      {/* keyboard-accessible alternative to dragging */}
      <select
        aria-label={`Move ${d.doctor_name} to`}
        value=""
        onChange={(e) => e.target.value && onMove(e.target.value as CategoryKey)}
        className="mt-2 w-full rounded-lg border border-line bg-cream/40 px-2 py-1 text-[11px] text-ink-muted opacity-70 transition-opacity focus:opacity-100 group-hover:opacity-100"
      >
        <option value="">Move to…</option>
        {CATEGORY_KEYS.filter((k) => k !== current).map((k) => <option key={k} value={k}>{CATEGORY_META[k].label}</option>)}
      </select>
    </article>
  );
}

function RecentChanges() {
  const { data, isLoading } = useQuery({
    queryKey: ["npp-cat-history"],
    queryFn: () => api.get<{ id: number; doctor_id: string; previous_category: string | null; new_category: string | null; source: string; changed_by_email: string | null; created_at: string; doctors: { doctor_name: string } | null }[]>("/npp/categories/history", { limit: 25 }),
  });
  const SOURCE: Record<string, string> = { MANUAL: "Manual", DRAG_DROP: "Drag & drop", BULK: "Bulk", CSV_IMPORT: "File import", SHEET_IMPORT: "Google Sheet", API: "API" };
  return (
    <Card className="mt-6">
      <CardHeader title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-walnut-500" />Recent category changes</span>}
        description="Audit trail: who changed what, when and how." />
      <div className="divide-y divide-line/70">
        {isLoading ? <div className="p-4"><Skeleton className="h-16" /></div> : !data?.length ? (
          <p className="px-5 py-6 text-sm text-ink-soft">No category changes yet.</p>
        ) : data.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
            <Link href={`/doctors/${c.doctor_id}`} className="font-medium text-ink hover:underline">{c.doctors?.doctor_name ?? "Doctor"}</Link>
            <CategoryBadge category={c.previous_category} /> <span className="text-ink-soft">→</span> <CategoryBadge category={c.new_category} />
            <span className="text-xs text-ink-soft">{SOURCE[c.source] ?? c.source} · {c.changed_by_email ?? "Google Sheet sync"} · {formatDateTime(c.created_at)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ import
interface ImportRow { row: number; doctor_id: string | null; doctor_name: string; email: string; category: string | null; current: string | null; action: string; reason: string | null; matched_by?: string }
interface ImportPreview { summary: Record<string, number>; rows: ImportRow[] }

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [clearBlank, setClearBlank] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!open) { setPreview(null); setClearBlank(false); } }, [open]);
  const upload = async (f: File) => {
    setBusy(true);
    try { setPreview(await api.upload<ImportPreview>("/npp/categories/import/preview", f)); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const apply = useMutation({
    mutationFn: () => api.post<{ updated: number; failed: { category: string; error: string }[] }>("/npp/categories/import/apply", { rows: preview!.rows, clear_blank: clearBlank }),
    onSuccess: (r) => {
      if (r.failed.length) toast.error(`Some updates failed: ${r.failed.map((f) => `${f.category}: ${f.error}`).join("; ")}`);
      toast.success(`${number(r.updated)} doctor categories updated`);
      invalidateCategoryData(qc);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = preview?.summary ?? {};
  const toUpdate = (s.update ?? 0) + (clearBlank ? s.blank_with_existing ?? 0 : 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Import doctor categories"
      description="CSV or Excel with Doctor_ID (best), Email or Doctor_Name, and Doctor_Category (A, B, C or blank)."
      footer={preview ? <>
        <Button variant="outline" onClick={() => setPreview(null)}>Choose another file</Button>
        <Button onClick={() => apply.mutate()} disabled={apply.isPending || toUpdate === 0}>
          {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm · update {number(toUpdate)}
        </Button>
      </> : undefined}>
      {!preview ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-cream/30 px-6 py-10 text-center hover:border-sage-300">
          {busy ? <Loader2 className="h-6 w-6 animate-spin text-sage-600" /> : <Upload className="h-6 w-6 text-walnut-500" />}
          <span className="text-sm font-medium">Choose a CSV or Excel file</span>
          <span className="text-xs text-ink-soft">Tip: export a category list first, edit the Doctor_Category column, then import it back.</span>
          <input type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Total records", s.total], ["Valid", s.valid], ["Invalid category", s.invalid], ["Not matched", s.not_found],
              ["Duplicate rows", s.duplicate], ["Already have a category", s.existing_categories], ["To be updated", s.update], ["Blank in file", s.blank]]
              .map(([l, v]) => (
                <div key={l as string} className="rounded-xl border border-line bg-white px-3 py-2">
                  <p className="text-[11px] text-ink-soft">{l}</p><p className="text-lg font-bold tabular-nums">{number((v as number) ?? 0)}</p>
                </div>
              ))}
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-line bg-cream/40 px-3 py-2.5">
            <Switch checked={clearBlank} onChange={setClearBlank} />
            <span className="text-xs leading-relaxed">
              <b>Clear categories for blank rows</b> ({number(s.blank_with_existing ?? 0)} doctors currently have a category).
              Off by default: a blank cell never erases an existing category unless you turn this on.
            </span>
          </label>
          <div className="max-h-64 overflow-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-ink-soft"><tr><th className="px-2 py-1.5">Row</th><th>Doctor</th><th>Now</th><th>File</th><th>Result</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 300).map((r) => (
                  <tr key={r.row} className="border-t border-line/70">
                    <td className="px-2 py-1 tabular-nums">{r.row}</td>
                    <td className="py-1">{r.doctor_name || r.email || "—"}{r.matched_by && <span className="text-ink-soft"> · by {r.matched_by}</span>}</td>
                    <td><CategoryBadge category={r.current} /></td>
                    <td>{r.category ?? <span className="text-ink-soft">blank</span>}</td>
                    <td className={cn(r.action === "update" ? "text-sage-700" : ["invalid", "not_found", "duplicate"].includes(r.action) ? "text-red-600" : "text-ink-soft")}>
                      {r.action === "update" ? "Will update" : r.action === "unchanged" ? "No change" : r.action === "blank" ? (clearBlank && r.current ? "Will clear" : "Kept") : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}
