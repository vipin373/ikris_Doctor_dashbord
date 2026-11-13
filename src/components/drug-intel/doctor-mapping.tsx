"use client";

import * as React from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Download, Loader2, Unlink, Users } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CategoryBadge, useGroups } from "@/components/npp/shared";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, EmptyState, Pagination, Skeleton, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, DEPARTMENT_LABEL, number } from "@/lib/utils";

interface DoctorRow {
  id: string; doctor_name: string; specialty: string | null; sub_department: string | null; institute: string | null; city: string | null;
  state: string | null; department: string; category: string | null; email: string | null; mapped: boolean; reason: string | null;
  mapping: { basis: string | null; created_by: string | null; created_at: string } | null;
}
interface Resp { items: DoctorRow[]; total: number; specialties: string[]; mapped_total: number; notice?: string }

/** Doctors for one medicine: suggested (specialty relevance, needs confirmation), mapped, or all. */
export function DoctorMappingPanel({ drugId, drugName }: { drugId: string; drugName: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const groups = useGroups();
  const [mode, setMode] = React.useState<"suggested" | "mapped" | "all">("suggested");
  const [f, setF] = React.useState({ q: "", category: "", state: "", institute: "", department: "", group_id: "" });
  const [deb, setDeb] = React.useState(f);
  const [page, setPage] = React.useState(1);
  const [sel, setSel] = React.useState<string[]>([]);
  const [groupOpen, setGroupOpen] = React.useState(false);
  React.useEffect(() => { const t = setTimeout(() => { setDeb(f); setPage(1); }, 300); return () => clearTimeout(t); }, [f]);
  React.useEffect(() => { setSel([]); setPage(1); }, [mode, drugId]);

  const data = useQuery({
    queryKey: ["drug-doctors", drugId, mode, deb, page],
    queryFn: () => api.get<Resp>(`/drug-intel/drugs/${drugId}/doctors`, { mode, ...deb, page, page_size: 50 }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["drug-doctors", drugId] }); qc.invalidateQueries({ queryKey: ["drug-intel-drug", drugId] }); };
  const map = useMutation({
    mutationFn: (ids: string[]) => api.post("/drug-intel/mappings", { drug_ids: [drugId], doctor_ids: ids, basis: mode === "suggested" ? "Suggested by specialty, confirmed by user" : "Confirmed by user" }),
    onSuccess: () => { toast.success("Mapped"); setSel([]); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const unmap = useMutation({
    mutationFn: (ids: string[]) => api.post("/drug-intel/mappings/remove", { drug_id: drugId, doctor_ids: ids }),
    onSuccess: () => { toast.success("Removed"); setSel([]); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data.data?.items ?? [];
  const allSel = rows.length > 0 && rows.every((r) => sel.includes(r.id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["suggested", "mapped", "all"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={cn("rounded-full border px-3 py-1 text-xs font-semibold", mode === m ? "border-walnut-700 bg-walnut-700 text-white" : "border-line bg-white text-ink-muted hover:border-sage-300")}>
            {m === "suggested" ? "Suggested (by specialty)" : m === "mapped" ? `Mapped (${number(data.data?.mapped_total ?? 0)})` : "All doctors"}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => api.download("/drug-intel/mappings/export", { drug_ids: drugId }, `doctors-${drugName}.csv`)}><Download className="h-3.5 w-3.5" />Export mapped</Button>
          <Button size="sm" variant="outline" disabled={!data.data?.mapped_total} onClick={() => setGroupOpen(true)}><Users className="h-3.5 w-3.5" />Create doctor group</Button>
        </div>
      </div>
      {mode === "suggested" && (
        <p className="mb-3 rounded-lg bg-cream/70 px-3 py-2 text-xs text-walnut-800">
          {data.data?.specialties.length ? <>Relevant specialties: <b>{data.data.specialties.join(", ")}</b>. </> : null}
          {data.data?.notice ?? "Suggestions are based on specialty only and do not mean the doctor prescribes this medicine. Confirm each one."}
        </p>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input placeholder="Doctor name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Doctor name" />
        <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category">
          <option value="">Any category</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="none">Unassigned</option>
        </Select>
        <Input placeholder="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} aria-label="State" />
        <Input placeholder="Hospital / institute" value={f.institute} onChange={(e) => setF({ ...f, institute: e.target.value })} aria-label="Hospital" />
        {me?.role === "ADMIN" ? (
          <Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} aria-label="Department">
            <option value="">All departments</option><option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option>
          </Select>
        ) : <span />}
        <Select value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })} aria-label="Doctor group">
          <option value="">Any group</option>
          {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      </div>

      {sel.length > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-sage-200 bg-sage-50 px-3 py-2 text-sm">
          <span>{sel.length} selected</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => map.mutate(sel)} disabled={map.isPending}>{map.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Confirm mapping</Button>
            <Button size="sm" variant="outline" onClick={() => unmap.mutate(sel)} disabled={unmap.isPending}><Unlink className="h-3.5 w-3.5" />Remove mapping</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        {data.isLoading ? <Skeleton className="m-3 h-40" /> : rows.length === 0 ? (
          <EmptyState title={mode === "mapped" ? "No doctors mapped yet" : "No doctors match"} description={mode === "suggested" ? "Try 'All doctors' to map manually." : undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead><tr>
                  <Th className="w-8"><input type="checkbox" aria-label="Select all on page" checked={allSel} onChange={() => setSel(allSel ? [] : rows.map((r) => r.id))} /></Th>
                  <Th>Doctor</Th><Th>Specialty</Th><Th>Hospital</Th><Th>Location</Th><Th>Category</Th><Th>Mapping</Th><Th />
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-cream/40">
                      <Td><input type="checkbox" aria-label={`Select ${r.doctor_name}`} checked={sel.includes(r.id)} onChange={() => setSel((s) => s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id])} /></Td>
                      <Td><Link href={`/doctors/${r.id}`} className="font-semibold hover:underline">{r.doctor_name}</Link><p className="text-[11px] text-ink-soft">{DEPARTMENT_LABEL[r.department] ?? r.department}</p></Td>
                      <Td className="text-xs">{[r.specialty, r.sub_department].filter(Boolean).join(" · ") || "—"}{r.reason && <p className="text-[11px] text-sage-700">{r.reason}</p>}</Td>
                      <Td className="max-w-[200px] text-xs text-ink-muted">{r.institute ?? "—"}</Td>
                      <Td className="text-xs">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</Td>
                      <Td><CategoryBadge category={r.category} /></Td>
                      <Td className="text-xs">{r.mapped ? <span className="font-semibold text-sage-700">Confirmed{r.mapping?.created_by ? ` by ${r.mapping.created_by}` : ""}</span> : mode === "suggested" ? <span className="text-glow-700">Suggested — not confirmed</span> : <span className="text-ink-soft">Not mapped</span>}</Td>
                      <Td>{r.mapped ? (
                        <Button size="sm" variant="ghost" onClick={() => unmap.mutate([r.id])}>Remove</Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => map.mutate([r.id])}>Confirm</Button>
                      )}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={50} total={data.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </div>
      {groupOpen && <GroupDialog drugId={drugId} drugName={drugName} onClose={() => setGroupOpen(false)} />}
    </div>
  );
}

function GroupDialog({ drugId, drugName, onClose }: { drugId: string; drugName: string; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = React.useState(`${drugName} — interested doctors`);
  const [dept, setDept] = React.useState(me?.role === "RARE_DISEASES" ? "RARE_DISEASES" : "NPP");
  const save = useMutation({
    mutationFn: () => api.post<{ members: number }>("/drug-intel/mappings/group", { drug_id: drugId, name, department: dept }),
    onSuccess: (r) => { toast.success(`Group created with ${r.members} doctors`); qc.invalidateQueries({ queryKey: ["npp-groups"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Create a doctor group from this medicine"
      description="Adds every doctor mapped to this medicine (in the chosen department) to a new group."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>Create group</Button></>}>
      <div className="space-y-3">
        <div><Label>Group name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        {me?.role === "ADMIN" && (
          <div><Label>Department</Label><Select value={dept} onChange={(e) => setDept(e.target.value)}><option value="NPP">NPP</option><option value="RARE_DISEASES">Rare Diseases</option></Select></div>
        )}
      </div>
    </Dialog>
  );
}
