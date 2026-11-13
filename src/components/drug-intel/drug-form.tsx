"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/misc";
import { api } from "@/lib/api";

export interface DrugRecord {
  id: string; generic_name: string; brand_names: string[]; alternative_names: string[]; kegg_drug_id: string | null;
  active_ingredient: string | null; combination_ingredients: string[]; therapeutic_area: string | null; sub_therapeutic_area: string | null;
  drug_class: string | null; atc_code: string | null; dosage_form: string | null; strength: string | null; route: string | null;
  manufacturer: string | null; mah: string | null; indication: string | null; orphan_eu: boolean | null; orphan_us: boolean | null;
  orphan_jp: boolean | null; drug_type: string | null; is_oncology: boolean; is_rare: boolean; source_url: string | null;
  verification_status: string; locked: boolean; created_at: string; updated_at: string; orphan_label?: string;
}

const TEXT_FIELDS: [keyof DrugRecord, string][] = [
  ["kegg_drug_id", "KEGG Drug ID (e.g. D01441, licensed use only)"], ["active_ingredient", "Active ingredient"],
  ["therapeutic_area", "Therapeutic area"], ["sub_therapeutic_area", "Sub-therapeutic area / disease"], ["drug_class", "Drug class"],
  ["atc_code", "ATC code"], ["dosage_form", "Dosage form"], ["strength", "Strength"], ["route", "Route of administration"],
  ["manufacturer", "Manufacturer"], ["mah", "Marketing authorisation holder"], ["drug_type", "Drug type"], ["source_url", "Source URL"],
];

function tri(v: boolean | null): string { return v === true ? "yes" : v === false ? "no" : ""; }
function untri(v: string): boolean | null { return v === "yes" ? true : v === "no" ? false : null; }

function DrugForm({ initial, onSave, saving, onCancel, submitLabel }: {
  initial: Partial<DrugRecord>; onSave: (body: Record<string, unknown>) => void; saving: boolean; onCancel: () => void; submitLabel: string;
}) {
  const [f, setF] = React.useState<Record<string, string | boolean>>({
    generic_name: initial.generic_name ?? "", brand_names: (initial.brand_names ?? []).join("; "),
    alternative_names: (initial.alternative_names ?? []).join("; "), indication: initial.indication ?? "",
    orphan_eu: tri(initial.orphan_eu ?? null), orphan_us: tri(initial.orphan_us ?? null), orphan_jp: tri(initial.orphan_jp ?? null),
    is_oncology: initial.is_oncology ?? false, is_rare: initial.is_rare ?? false, verification_status: initial.verification_status ?? "Verified",
    ...Object.fromEntries(TEXT_FIELDS.map(([k]) => [k, (initial[k] as string | null) ?? ""])),
  });
  const submit = () => {
    const body: Record<string, unknown> = {
      generic_name: String(f.generic_name).trim(),
      brand_names: String(f.brand_names).split(/[;|]/).map((s) => s.trim()).filter(Boolean),
      alternative_names: String(f.alternative_names).split(/[;|]/).map((s) => s.trim()).filter(Boolean),
      indication: String(f.indication) || null, orphan_eu: untri(String(f.orphan_eu)), orphan_us: untri(String(f.orphan_us)),
      orphan_jp: untri(String(f.orphan_jp)), is_oncology: f.is_oncology, is_rare: f.is_rare, verification_status: f.verification_status,
    };
    TEXT_FIELDS.forEach(([k]) => { body[k] = String(f[k]).trim() || null; });
    onSave(body);
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>Generic name (INN) *</Label><Input value={String(f.generic_name)} onChange={(e) => setF({ ...f, generic_name: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Brand names (separate with ;)</Label><Input value={String(f.brand_names)} onChange={(e) => setF({ ...f, brand_names: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Alternative names (separate with ;)</Label><Input value={String(f.alternative_names)} onChange={(e) => setF({ ...f, alternative_names: e.target.value })} /></div>
        {TEXT_FIELDS.map(([k, label]) => (
          <div key={k}><Label>{label}</Label><Input value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
        ))}
        {(["orphan_eu", "orphan_us", "orphan_jp"] as const).map((k) => (
          <div key={k}><Label>Orphan status — {k === "orphan_eu" ? "EU" : k === "orphan_us" ? "USA" : "Japan"}</Label>
            <Select value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
              <option value="">Not verified</option><option value="yes">Orphan</option><option value="no">Not orphan</option>
            </Select>
          </div>
        ))}
        <div><Label>Verification status</Label>
          <Select value={String(f.verification_status)} onChange={(e) => setF({ ...f, verification_status: e.target.value })}>
            <option>Verified</option><option>Source-imported</option><option>Needs Review</option><option>Not Verified</option>
          </Select>
        </div>
        <div className="sm:col-span-2"><Label>Indication</Label><Textarea rows={3} value={String(f.indication)} onChange={(e) => setF({ ...f, indication: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.is_oncology)} onChange={(e) => setF({ ...f, is_oncology: e.target.checked })} />Oncology medicine</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.is_rare)} onChange={(e) => setF({ ...f, is_rare: e.target.checked })} />Rare disease medicine</label>
      </div>
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !String(f.generic_name).trim()}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}</Button>
      </div>
      <p className="text-[11px] text-ink-soft">Saving protects this record from automatic imports. Every change is written to the audit log.</p>
    </div>
  );
}

export function NewDrugDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>("/drug-intel/drugs", body),
    onSuccess: (r) => { toast.success(`Created ${r.id}`); qc.invalidateQueries({ queryKey: ["drug-intel-list"] }); router.push(`/drug-intel/drugs/${r.id}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Add a medicine" description="Use the official generic name. Duplicates are detected by active substance.">
      <DrugForm initial={{}} onSave={(b) => save.mutate(b)} saving={save.isPending} onCancel={() => onOpenChange(false)} submitLabel="Create medicine" />
    </Dialog>
  );
}

export function EditDrugDialog({ open, onOpenChange, drug }: { open: boolean; onOpenChange: (v: boolean) => void; drug: DrugRecord }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/drug-intel/drugs/${drug.id}`, body),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["drug-intel-drug", drug.id] }); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={`Edit ${drug.generic_name}`} description={drug.id}>
      <DrugForm initial={drug} onSave={(b) => save.mutate(b)} saving={save.isPending} onCancel={() => onOpenChange(false)} submitLabel="Save changes" />
    </Dialog>
  );
}
