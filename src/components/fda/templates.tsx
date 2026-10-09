"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, History, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, Skeleton, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { AREA_LABEL, CHANNEL_LABEL, TEMPLATE_TYPES, type FdaConfig, type FdaDoctor, type FdaDrug, type MessageTemplate } from "@/lib/fda";
import { cn, formatDateTime } from "@/lib/utils";
import { AreaBadge } from "./drugs";
import { VariableChips } from "./variables";

const STATUS_TONE = { ACTIVE: "green", INACTIVE: "neutral", DRAFT: "amber" } as const;
const WA_TONE = { APPROVED: "green", PENDING: "amber", REJECTED: "red", NOT_SUBMITTED: "neutral" } as const;

const EXAMPLE = `Dear {{doctor_name}},

We would like to share an update regarding {{drug_name}} ({{active_ingredient}}).

Therapeutic Area:
{{therapeutic_area}}

Indication:
{{indication}}

For further information, please contact Ikris Pharma Network.

Regards,
{{sender_name}}`;

export function FdaTemplates({ config }: { config?: FdaConfig }) {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Partial<MessageTemplate> | null>(null);
  const [previewing, setPreviewing] = React.useState<MessageTemplate | null>(null);
  const [history, setHistory] = React.useState<MessageTemplate | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["fda-templates", "all"], queryFn: () => api.get<MessageTemplate[]>("/fda/templates") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fda-templates"] });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "deactivate" | "duplicate" | "delete" }) =>
      action === "delete" ? api.del(`/fda/templates/${id}`) : api.post(`/fda/templates/${id}/${action}`),
    onSuccess: (_r, v) => { toast.success({ activate: "Activated", deactivate: "Deactivated", duplicate: "Duplicated as a draft", delete: "Deleted" }[v.action]); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rows = (data ?? []).filter((t) => {
    if (q && !t.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "WHATSAPP" || filter === "EMAIL") return t.channel === filter || t.channel === "BOTH";
    if (["ACTIVE", "INACTIVE", "DRAFT"].includes(filter)) return t.status === filter;
    return true;
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Button size="sm" onClick={() => setEditing({ channel: "WHATSAPP", department: "GENERAL", template_type: "FDA_DRUG_UPDATE", language: "en", status: "DRAFT", body: EXAMPLE, whatsapp_variables: [], whatsapp_approval_status: "NOT_SUBMITTED" })}>
          <Plus className="h-3.5 w-3.5" /> Create New Template
        </Button>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {[["all", "All"], ["WHATSAPP", "WhatsApp"], ["EMAIL", "Email"], ["ACTIVE", "Active"], ["INACTIVE", "Inactive"], ["DRAFT", "Draft"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full border px-2.5 py-1", filter === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line text-ink-muted")}>{l}</button>
          ))}
        </div>
      </div>
      {isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !rows.length ? (
        <EmptyState title="No templates yet" description="Create one manually; it can then be used in Single Message and Bulk campaigns once activated." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>Template</Th><Th>Department</Th><Th>Channel</Th><Th>Type</Th><Th>Status</Th><Th>WhatsApp approval</Th><Th>Updated</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <Td><p className="font-medium text-ink">{t.name}</p><p className="text-[11px] text-ink-soft">v{t.version} · {t.language}</p></Td>
                  <Td><AreaBadge value={t.department} /></Td>
                  <Td className="text-xs">{CHANNEL_LABEL[t.channel]}</Td>
                  <Td className="text-xs">{TEMPLATE_TYPES[t.template_type]}</Td>
                  <Td><Badge tone={STATUS_TONE[t.status]}>{t.status[0] + t.status.slice(1).toLowerCase()}</Badge></Td>
                  <Td>{t.channel === "EMAIL" ? <span className="text-xs text-ink-soft">—</span> : <Badge tone={WA_TONE[t.whatsapp_approval_status]}>{t.whatsapp_approval_status.replace("_", " ").toLowerCase()}</Badge>}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-soft">{formatDateTime(t.updated_at)}</Td>
                  <Td>
                    <div className="flex justify-end gap-0.5">
                      <IconBtn label="Preview" onClick={() => setPreviewing(t)}><Eye className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label="Edit" onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label="Duplicate" onClick={() => act.mutate({ id: t.id, action: "duplicate" })}><Copy className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label={t.status === "ACTIVE" ? "Deactivate" : "Activate"} onClick={() => act.mutate({ id: t.id, action: t.status === "ACTIVE" ? "deactivate" : "activate" })}><Power className={cn("h-3.5 w-3.5", t.status === "ACTIVE" && "text-emerald-600")} /></IconBtn>
                      <IconBtn label="Version history" onClick={() => setHistory(t)}><History className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label="Delete" onClick={() => { if (confirm(`Delete "${t.name}"? Messages already sent keep their exact text.`)) act.mutate({ id: t.id, action: "delete" }); }}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TemplateEditor initial={editing} config={config} onClose={(saved) => { setEditing(null); if (saved) refresh(); }} />}
      {previewing && <TemplatePreview t={previewing} onClose={() => setPreviewing(null)} />}
      {history && <VersionHistory t={history} onClose={() => setHistory(null)} />}
    </Card>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button title={label} aria-label={label} onClick={onClick} className="rounded p-1.5 text-ink-soft hover:bg-slate-100 hover:text-ink">{children}</button>;
}

function TemplateEditor({ initial, config, onClose }: { initial: Partial<MessageTemplate>; config?: FdaConfig; onClose: (saved?: boolean) => void }) {
  const { me } = useAuth();
  const [t, setT] = React.useState<Partial<MessageTemplate>>(initial);
  const set = (patch: Partial<MessageTemplate>) => setT((x) => ({ ...x, ...patch }));
  const [focus, setFocus] = React.useState<"body" | "subject">("body");
  const depts = me?.role === "RARE_DISEASES" ? ["RARE_DISEASE", "GENERAL"] : me?.role === "NPP" ? ["ONCOLOGY", "HEMATOLOGY", "NPP", "GENERAL"] : ["ONCOLOGY", "HEMATOLOGY", "RARE_DISEASE", "NPP", "GENERAL"];
  const save = useMutation({
    mutationFn: (status?: "DRAFT" | "ACTIVE") => {
      const body = {
        name: t.name, department: t.department, channel: t.channel, template_type: t.template_type, language: t.language || "en",
        subject: t.channel === "WHATSAPP" ? null : t.subject || null, body: t.body, status: status ?? t.status ?? "DRAFT",
        whatsapp_template_name: t.whatsapp_template_name || null, whatsapp_template_id: t.whatsapp_template_id || null,
        whatsapp_approval_status: t.whatsapp_approval_status ?? "NOT_SUBMITTED", whatsapp_variables: t.whatsapp_variables ?? [],
      };
      return t.id ? api.put(`/fda/templates/${t.id}`, body) : api.post("/fda/templates", body);
    },
    onSuccess: () => { toast.success(t.id ? "Saved as a new version" : "Template created"); onClose(true); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  const wa = t.channel !== "EMAIL";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={t.id ? `Edit template · v${t.version}` : "Create New Template"}
      description="Write the message yourself; variables are replaced with real database values when a message is created."
      footer={<>
        <Button variant="outline" onClick={() => onClose()}>Cancel</Button>
        <Button variant="outline" disabled={save.isPending || !t.name || !t.body} onClick={() => save.mutate(t.id ? undefined : "DRAFT")}>{t.id ? "Save" : "Save draft"}</Button>
        {t.status !== "ACTIVE" && <Button disabled={save.isPending || !t.name || !t.body} onClick={() => save.mutate("ACTIVE")}>Save & activate</Button>}
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Template name</Label><Input value={t.name ?? ""} onChange={(e) => set({ name: e.target.value })} maxLength={160} /></div>
          <div><Label>Department</Label><Select value={t.department} onChange={(e) => set({ department: e.target.value })}>{depts.map((d) => <option key={d} value={d}>{AREA_LABEL[d]}</option>)}</Select></div>
          <div><Label>Channel</Label><Select value={t.channel} onChange={(e) => set({ channel: e.target.value as MessageTemplate["channel"] })}>{["WHATSAPP", "EMAIL", "BOTH"].map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select></div>
          <div><Label>Template type</Label><Select value={t.template_type} onChange={(e) => set({ template_type: e.target.value })}>{Object.entries(TEMPLATE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label>Language</Label><Select value={t.language} onChange={(e) => set({ language: e.target.value })}><option value="en">English</option><option value="hi">Hindi</option><option value="en_US">English (US)</option></Select></div>
        </div>
        {t.channel !== "WHATSAPP" && (
          <div><Label>Email subject</Label><Input id="tpl-subject" value={t.subject ?? ""} onFocus={() => setFocus("subject")} onChange={(e) => set({ subject: e.target.value })} placeholder="FDA Drug Information Update – {{drug_name}}" /></div>
        )}
        <div>
          <Label>Message</Label>
          <Textarea id="tpl-body" rows={12} value={t.body ?? ""} onFocus={() => setFocus("body")} onChange={(e) => set({ body: e.target.value })} />
        </div>
        <VariableChips config={config} targetId={focus === "subject" ? "tpl-subject" : "tpl-body"}
          value={focus === "subject" ? t.subject ?? "" : t.body ?? ""} onChange={(v) => set(focus === "subject" ? { subject: v } : { body: v })} />
        {wa && (
          <div className="space-y-2 rounded-md border border-line p-3">
            <p className="text-xs font-semibold text-ink">WhatsApp Business template (Cunnekt)</p>
            <p className="text-[11px] text-ink-soft">To message doctors who have not written to you in the last 24 hours, WhatsApp requires a template approved in Cunnekt. Enter its name and the variable that fills each {"{{1}}, {{2}}…"} placeholder. Mark it approved only once Cunnekt shows it approved.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cunnekt template name</Label><Input value={t.whatsapp_template_name ?? ""} onChange={(e) => set({ whatsapp_template_name: e.target.value })} placeholder="fda_drug_update" /></div>
              <div><Label>Approval status (as shown in Cunnekt)</Label><Select value={t.whatsapp_approval_status} onChange={(e) => set({ whatsapp_approval_status: e.target.value as MessageTemplate["whatsapp_approval_status"] })}>
                <option value="NOT_SUBMITTED">Not submitted</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></Select></div>
              <div className="col-span-2">
                <Label>Variables for {"{{1}}, {{2}}, …"} in order (comma separated)</Label>
                <Input value={(t.whatsapp_variables ?? []).join(", ")} onChange={(e) => set({ whatsapp_variables: e.target.value.split(",").map((x) => x.trim().replace(/[{}]/g, "")).filter(Boolean) })} placeholder="doctor_name, drug_name, active_ingredient" />
              </div>
            </div>
          </div>
        )}
        {t.id && <p className="text-[11px] text-ink-soft">Saving creates version {(t.version ?? 1) + 1} when the content changes. Messages already sent keep their exact text.</p>}
      </div>
    </Dialog>
  );
}

function TemplatePreview({ t, onClose }: { t: MessageTemplate; onClose: () => void }) {
  const [doctorId, setDoctorId] = React.useState("");
  const [drugId, setDrugId] = React.useState("");
  const channel = t.channel === "BOTH" ? "EMAIL" : t.channel;
  const [ch, setCh] = React.useState<"WHATSAPP" | "EMAIL">(channel);
  const doctors = useQuery({ queryKey: ["fda-doctors", "", "all", 1, "preview"], queryFn: () => api.get<{ items: FdaDoctor[] }>("/fda/doctors", { page_size: 50 }) });
  const drugs = useQuery({ queryKey: ["fda-drugs-preview"], queryFn: () => api.get<{ items: FdaDrug[] }>("/fda/drugs", { sendable: true, page_size: 50 }) });
  const prev = useQuery({
    queryKey: ["tpl-preview", t.id, t.version, doctorId, drugId, ch],
    queryFn: () => api.post<{ subject: string | null; body: string; html?: string; missing: string[]; unknown: string[] }>("/fda/templates/preview", {
      subject: t.subject, body: t.body, channel: ch, doctor_id: doctorId || null, drug_id: drugId || null }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Preview · ${t.name}`} description="Filled with a real doctor and FDA drug from the database. Unfilled variables stay visible.">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Doctor</Label><Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">(none)</option>{doctors.data?.items.map((d) => <option key={d.id} value={d.id}>{d.doctor_name}</option>)}</Select></div>
          <div><Label>FDA drug</Label><Select value={drugId} onChange={(e) => setDrugId(e.target.value)}><option value="">(none)</option>{drugs.data?.items.map((d) => <option key={d.id} value={d.id}>{d.drug_name}</option>)}</Select></div>
        </div>
        {t.channel === "BOTH" && <div className="flex gap-1 text-xs">{(["EMAIL", "WHATSAPP"] as const).map((c) => <button key={c} onClick={() => setCh(c)} className={cn("rounded-full border px-2.5 py-1", ch === c ? "border-brand-600 bg-brand-50" : "border-line")}>{CHANNEL_LABEL[c]}</button>)}</div>}
        {prev.data?.missing.length ? <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">No value yet for: {prev.data.missing.map((m) => `{{${m}}}`).join(", ")}</p> : null}
        {!prev.data ? <Skeleton className="h-48" /> : ch === "EMAIL" ? (
          <div className="rounded-md border border-line">
            <div className="border-b border-line bg-slate-50 px-3 py-2 text-xs"><span className="text-ink-soft">Subject: </span><b>{prev.data.subject}</b></div>
            <iframe title="Preview" sandbox="" className="h-96 w-full" srcDoc={prev.data.html} />
          </div>
        ) : <div className="whitespace-pre-wrap rounded-md border border-emerald-100 bg-emerald-50/50 p-3 text-sm">{prev.data.body}</div>}
      </div>
    </Dialog>
  );
}

function VersionHistory({ t, onClose }: { t: MessageTemplate; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ["tpl-versions", t.id], queryFn: () => api.get<{ id: number; version: number; name: string; subject: string | null; body: string; created_at: string }[]>(`/fda/templates/${t.id}/versions`) });
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Version history · ${t.name}`}>
      {!data ? <Skeleton className="h-32" /> : (
        <div className="divide-y divide-line rounded-md border border-line">
          {data.map((v) => (
            <div key={v.id} className="px-3 py-2 text-sm">
              <button className="flex w-full items-center justify-between" onClick={() => setOpen(open === v.id ? null : v.id)}>
                <span className="font-medium">Version {v.version}{v.version === t.version && <Badge tone="green" className="ml-2">current</Badge>}</span>
                <span className="text-xs text-ink-soft">{formatDateTime(v.created_at)}</span>
              </button>
              {open === v.id && <div className="mt-2 space-y-1 text-xs">{v.subject && <p><b>Subject:</b> {v.subject}</p>}<pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans">{v.body}</pre></div>}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
