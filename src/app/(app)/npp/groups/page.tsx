"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, GripVertical, Loader2, Mail, MessageCircle, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import {
  CATEGORY_META, CategoryBadge, CrmFilterFields, toApiFilters, useGroups, type CrmFilters, type GroupStat,
} from "@/components/npp/shared";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, PageHeader, Pagination, Skeleton, Switch, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, number } from "@/lib/utils";

interface Member {
  id: string; doctor_name: string; category: string | null; sub_department: string | null; specialty: string | null;
  institute: string | null; city: string | null; email_norm: string | null; whatsapp_number: string | null; added_at: string;
}
const DRAG = "application/x-ikris-doctors";

export default function GroupsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const { data: groups, isLoading } = useGroups();
  const [active, setActive] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  React.useEffect(() => { if (!active && groups?.length) setActive(groups[0].id); }, [groups, active]);

  const addDrop = useMutation({
    mutationFn: ({ group, ids }: { group: string; ids: string[] }) =>
      api.post<{ added: number; already_in_group: number }>(`/npp/groups/${group}/members`, { doctor_ids: ids }),
    onSuccess: (r) => {
      toast.success(r.added ? `${number(r.added)} added to the group` : "Already in this group");
      qc.invalidateQueries({ queryKey: ["npp-groups"] });
      qc.invalidateQueries({ queryKey: ["npp-group-members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (me && !me.departments.includes("NPP")) return <Card><EmptyState title="No access" description="Doctor groups are for NPP." /></Card>;
  const current = groups?.find((g) => g.id === active) ?? null;

  return (
    <div>
      <PageHeader breadcrumb={<Link href="/npp" className="hover:underline">NPP</Link>} title="Doctor Groups & Segmentation"
        description="Build target lists for email and WhatsApp. A doctor can be in many groups; groups never change a doctor's category."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New group</Button>} />

      <div className="grid gap-5 xl:grid-cols-[320px_1fr_300px]">
        {/* group list (drop targets) */}
        <div className="space-y-2.5">
          {isLoading ? <Skeleton className="h-40" /> : !groups?.length ? (
            <Card><EmptyState icon={Users} title="No groups yet" description="Create one from filters, e.g. Category A + Oncology + Delhi." /></Card>
          ) : groups.map((g) => (
            <button key={g.id} onClick={() => setActive(g.id)}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setDropTarget(g.id); } }}
              onDragLeave={() => setDropTarget((t) => (t === g.id ? null : t))}
              onDrop={(e) => {
                e.preventDefault(); setDropTarget(null);
                try { const ids = JSON.parse(e.dataTransfer.getData(DRAG) || "[]"); if (ids.length) addDrop.mutate({ group: g.id, ids }); } catch { /* ignore */ }
              }}
              className={cn("w-full rounded-card border bg-white p-3.5 text-left shadow-card transition-all duration-250",
                active === g.id ? "border-sage-300 ring-2 ring-sage-200" : "border-line/80 hover:border-sage-200 hover:shadow-lift",
                dropTarget === g.id && "border-glow-400 shadow-glow ring-2 ring-glow-200")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{g.name}</p>
                <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold tabular-nums">{number(g.members)}</span>
              </div>
              {g.description && <p className="mt-0.5 line-clamp-1 text-xs text-ink-soft">{g.description}</p>}
              <div className="mt-2 flex flex-wrap gap-1 text-[10.5px]">
                {([["A", g.cat_a], ["B", g.cat_b], ["C", g.cat_c], ["UNASSIGNED", g.unassigned]] as const).map(([k, v]) => v > 0 && (
                  <span key={k} className={cn("rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset", CATEGORY_META[k].badge)}>{CATEGORY_META[k].short === "—" ? "Unassigned" : k}: {v}</span>
                ))}
                <span className="text-ink-soft">· {number(g.with_email)} email · {number(g.with_whatsapp)} WhatsApp</span>
              </div>
              {dropTarget === g.id && <p className="mt-1 text-xs font-semibold text-glow-700">Drop to add</p>}
            </button>
          ))}
        </div>

        {/* group detail */}
        <div>{current ? <GroupDetail key={current.id} group={current} onDeleted={() => setActive(null)} /> :
          !isLoading && groups?.length ? <Card><EmptyState title="Select a group" /></Card> : null}</div>

        {/* doctor finder (drag source) */}
        <DoctorFinder />
      </div>

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setActive(id)} />
    </div>
  );
}

function GroupDetail({ group, onDeleted }: { group: GroupStat; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [rename, setRename] = React.useState<{ name: string; description: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, isLoading } = useQuery({
    queryKey: ["npp-group-members", group.id, dq, page],
    queryFn: () => api.get<{ items: Member[]; total: number }>(`/npp/groups/${group.id}/members`, { q: dq || undefined, page, page_size: 25 }),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["npp-groups"] }); qc.invalidateQueries({ queryKey: ["npp-group-members"] }); };
  const remove = useMutation({
    mutationFn: () => api.post<{ removed: number }>(`/npp/groups/${group.id}/members/remove`, { doctor_ids: [...sel] }),
    onSuccess: (r) => { toast.success(`${number(r.removed)} removed from the group`); setSel(new Set()); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/npp/groups/${group.id}`, rename),
    onSuccess: () => { toast.success("Group updated"); setRename(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/npp/groups/${group.id}`),
    onSuccess: () => { toast.success("Group deleted (doctors are not affected)"); setConfirmDelete(false); refresh(); onDeleted(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader title={group.name} description={group.description || `${number(group.members)} doctors`}
        action={<div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setRename({ name: group.name, description: group.description ?? "" })}><Pencil className="h-3.5 w-3.5" /> Rename</Button>
          <Button size="sm" variant="ghost" onClick={() => api.download(`/npp/groups/${group.id}/export`, {}, `${group.name}.csv`).catch((e: Error) => toast.error(e.message))}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Link href={`/npp/outreach?group=${group.id}&channel=EMAIL`}><Button size="sm" variant="secondary"><Mail className="h-3.5 w-3.5" /> Email group</Button></Link>
          <Link href={`/npp/outreach?group=${group.id}&channel=WHATSAPP`}><Button size="sm" variant="secondary"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp group</Button></Link>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className="pl-9" />
        </div>
        {sel.size > 0 && (
          <Button size="sm" variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remove {sel.size} from group
          </Button>
        )}
      </div>
      {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : items.length === 0 ? (
        <EmptyState icon={Users} title={dq ? "No matches" : "No doctors in this group yet"} description="Drag doctors from the finder on the right, or add them from the doctor list." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <Th className="w-8"><input type="checkbox" aria-label="Select all on page" checked={items.every((m) => sel.has(m.id))}
                onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...items.map((m) => m.id)]) : new Set([...sel].filter((i) => !items.some((m) => m.id === i))))} /></Th>
              <Th>Doctor</Th><Th>Category</Th><Th>Hospital</Th><Th>Contact</Th>
            </tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="hover:bg-cream/30">
                  <Td><input type="checkbox" checked={sel.has(m.id)} aria-label={`Select ${m.doctor_name}`}
                    onChange={() => setSel((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} /></Td>
                  <Td><Link href={`/doctors/${m.id}`} className="font-medium hover:underline">{m.doctor_name}</Link>
                    <p className="text-[11px] text-ink-soft">{m.sub_department || m.specialty}</p></Td>
                  <Td><CategoryBadge category={m.category} /></Td>
                  <Td className="text-xs">{m.institute}<p className="text-ink-soft">{m.city}</p></Td>
                  <Td className="text-xs">{m.email_norm ? "Email" : <span className="text-ink-soft">No email</span>} · {m.whatsapp_number ? "WhatsApp" : <span className="text-ink-soft">No WhatsApp</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 25 && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}

      <Dialog open={!!rename} onOpenChange={(v) => !v && setRename(null)} title="Rename group"
        footer={<><Button variant="outline" onClick={() => setRename(null)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !rename?.name.trim()}>Save</Button></>}>
        {rename && <div className="space-y-3">
          <div><Label>Name</Label><Input className="mt-1" value={rename.name} maxLength={120} onChange={(e) => setRename({ ...rename, name: e.target.value })} /></div>
          <div><Label>Description</Label><Textarea className="mt-1" rows={2} value={rename.description} maxLength={500} onChange={(e) => setRename({ ...rename, description: e.target.value })} /></div>
        </div>}
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete “${group.name}”?`}
        description="Only the group is deleted. The doctors, their categories and their communication history stay exactly as they are."
        footer={<><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => del.mutate()} disabled={del.isPending}>Delete group</Button></>}>
        <span />
      </Dialog>
    </Card>
  );
}

function DoctorFinder() {
  const [f, setF] = React.useState<{ q: string; category: string }>({ q: "", category: "" });
  const [dq, setDq] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDq(f.q.trim()), 300); return () => clearTimeout(t); }, [f.q]);
  const { data, isLoading } = useQuery({
    queryKey: ["npp-finder", dq, f.category],
    queryFn: () => api.get<{ items: Member[]; total: number }>("/doctors", { department: "NPP", q: dq || undefined, category: f.category || undefined, page_size: 30 }),
  });
  return (
    <Card className="h-fit xl:sticky xl:top-20">
      <CardHeader title="Find doctors" description="Drag a doctor onto a group on the left." />
      <div className="space-y-2 p-3">
        <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Name, hospital, city…" />
        <select className="w-full rounded-[10px] border border-line bg-white px-2 py-1.5 text-sm" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category">
          <option value="">Any category</option><option value="A">Category A</option><option value="B">Category B</option><option value="C">Category C</option><option value="none">Unassigned</option>
        </select>
      </div>
      <div className="max-h-[60vh] space-y-1.5 overflow-y-auto px-3 pb-3">
        {isLoading ? <Skeleton className="h-24" /> : (data?.items ?? []).map((d) => (
          <div key={d.id} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG, JSON.stringify([d.id])); e.dataTransfer.effectAllowed = "copy"; }}
            className="flex cursor-grab items-center gap-2 rounded-xl border border-line/80 bg-white px-2.5 py-2 text-xs shadow-card hover:border-sage-300 active:cursor-grabbing">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
            <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink">{d.doctor_name}</p><p className="truncate text-ink-soft">{d.institute || d.city}</p></div>
            <CategoryBadge category={d.category} />
          </div>
        ))}
        {data && data.total > 30 && <p className="pt-1 text-center text-[11px] text-ink-soft">Showing 30 of {number(data.total)}; search to narrow.</p>}
      </div>
    </Card>
  );
}

function CreateGroupDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [filters, setFilters] = React.useState<CrmFilters>({});
  const [addMatching, setAddMatching] = React.useState(true);
  React.useEffect(() => { if (open) { setName(""); setDesc(""); setFilters({}); setAddMatching(true); } }, [open]);
  const apiFilters = toApiFilters(filters);
  const hasFilters = Object.keys(apiFilters).length > 0;
  const count = useQuery({
    queryKey: ["npp-group-count", apiFilters],
    queryFn: () => api.post<{ total: number; distribution: Record<string, number> }>("/npp/categories/preview", { filters: apiFilters }),
    enabled: open && hasFilters,
  });
  const suggested = [filters.category && (filters.category === "none" ? "Unassigned" : `Category ${filters.category}`), filters.sub_department, filters.city, filters.state]
    .filter(Boolean).join(" – ");
  const create = useMutation({
    mutationFn: () => api.post<{ id: string; added: number }>("/npp/groups", { name: name.trim() || suggested, description: desc || null, filters: apiFilters, add_matching: addMatching && hasFilters }),
    onSuccess: (g) => { toast.success(`Group created with ${number(g.added)} doctors`); qc.invalidateQueries({ queryKey: ["npp-groups"] }); onCreated(g.id); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="New doctor group"
      description="Combine category, specialization, location and hospital. Matching doctors are added now; you can add or remove doctors later."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={() => create.mutate()} disabled={create.isPending || !(name.trim() || suggested)}>
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create group{addMatching && count.data ? ` with ${number(count.data.total)}` : ""}
        </Button></>}>
      <div className="space-y-3 text-sm">
        <div><Label>Group name</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested || "e.g. Category A – Oncology – Delhi"} maxLength={120} /></div>
        <div><Label>Description (optional)</Label><Input className="mt-1" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></div>
        <div><Label>Filters</Label><div className="mt-1"><CrmFilterFields value={filters} onChange={setFilters} /></div></div>
        <label className="flex items-center gap-3 rounded-xl border border-line bg-cream/40 px-3 py-2">
          <Switch checked={addMatching} onChange={setAddMatching} />
          <span className="text-xs">Add the {hasFilters ? (count.isLoading ? "…" : number(count.data?.total ?? 0)) : "matching"} doctors now
            {!hasFilters && " (choose at least one filter, or create an empty group)"}</span>
        </label>
        {count.data && (
          <div className="flex flex-wrap gap-1.5">
            {(["A", "B", "C", "UNASSIGNED"] as const).map((k) => (
              <span key={k} className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", CATEGORY_META[k].badge)}>
                {CATEGORY_META[k].label}: {number(count.data!.distribution[k] ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
