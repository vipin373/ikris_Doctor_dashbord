"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, FileText, Link2Off, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, PageHeader, Skeleton, Switch, Tooltip } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { lintTemplate, mergeTags, sheetLink } from "@/lib/templates";
import type { EmailTemplate } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDateTime } from "@/lib/utils";

type ListResponse = { items: EmailTemplate[]; editable: Record<string, boolean> };

export default function TemplatesPage() {
  const { me } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.get<ListResponse>("/templates"),
  });

  const groups = React.useMemo(() => {
    const bySource = new Map<string, EmailTemplate[]>();
    (data?.items ?? []).forEach((t) => {
      const key = t.spreadsheet_id;
      bySource.set(key, [...(bySource.get(key) ?? []), t]);
    });
    return Array.from(bySource.values());
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Email Templates"
        description="The templates your Google Sheet automations send. Changes made here are written straight into the Google Sheet, so the next automated email uses them."
      />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}
      {data && data.items.length === 0 && (
        <Card>
          <EmptyState icon={FileText} title="No templates yet"
            description={me?.role === "ADMIN" ? "Run Google Sheets → Sync now to load the templates from the sheets." : "Templates appear after an administrator syncs the Google Sheets."} />
        </Card>
      )}
      <div className="space-y-6">
        {groups.map((items) => (
          <SourceGroup key={items[0].spreadsheet_id} items={items} editable={!!data?.editable[items[0].spreadsheet_id]} isAdmin={me?.role === "ADMIN"} />
        ))}
      </div>
    </div>
  );
}

function SourceGroup({ items, editable, isAdmin }: { items: EmailTemplate[]; editable: boolean; isAdmin: boolean }) {
  const first = items[0];
  const emails = items.filter((t) => t.kind === "email");
  const campaigns = items.filter((t) => t.kind === "campaign");
  const subjects = items.filter((t) => t.kind === "subject_line");
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{first.source_name ?? "Google Sheet"}</h2>
        <Badge tone={departmentTone(first.department)}>{DEPARTMENT_LABEL[first.department]}</Badge>
        {editable ? (
          <Badge tone="green"><Check className="h-3 w-3" /> Editing connected</Badge>
        ) : (
          <Tooltip label={isAdmin ? "Connect it in Google Sheets Sync Center" : "Ask an administrator to connect it"}>
            <Badge tone="amber"><Link2Off className="h-3 w-3" /> View only</Badge>
          </Tooltip>
        )}
        <a href={sheetLink(first)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          Open sheet <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {!editable && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          You can read these templates. To change them from the dashboard, {isAdmin
            ? <><Link href="/google-sheets" className="font-semibold underline">connect editing for this sheet</Link> (one-time, about 3 minutes).</>
            : "an administrator needs to connect editing for this sheet once."}
        </div>
      )}

      {campaigns.length > 0 && (
        <Card>
          <CardHeader title="Campaigns" description="Each row in the Campaigns tab. Only Active campaigns are sent." />
          <div className="divide-y divide-line">
            {campaigns.map((t) => <CampaignRow key={t.id} t={t} editable={editable} />)}
          </div>
        </Card>
      )}

      {emails.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {emails.map((t) => <TemplateCard key={t.id} t={t} />)}
        </div>
      )}

      {subjects.length > 0 && <SubjectLines items={subjects} editable={editable} />}
    </section>
  );
}

function TemplateCard({ t }: { t: EmailTemplate }) {
  const empty = !t.subject && !t.body_html;
  const lints = lintTemplate(t);
  return (
    <Link href={`/templates/${t.id}`} className="group block rounded-lg border border-line bg-white p-4 shadow-card transition-colors hover:border-brand-300">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{t.name}</p>
        {empty ? <Badge tone="neutral">Empty</Badge> : lints.some((l) => l.level === "warning") && (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
        <span className="text-ink-soft">Subject: </span>{t.subject?.trim() || <span className="italic text-ink-soft">none</span>}
      </p>
      {t.notes && <p className="mt-2 line-clamp-2 whitespace-pre-line text-[11px] text-ink-soft">{t.notes}</p>}
      <div className="mt-3 flex items-center justify-between text-[11px] text-ink-soft">
        <span>{mergeTags(`${t.subject} ${t.body_html}`).map((m) => `{{${m}}}`).join(" ") || "No merge tags"}</span>
        <span className="inline-flex items-center gap-1 font-medium text-brand-700 opacity-0 group-hover:opacity-100">
          {empty ? "Write" : "Open"} <Pencil className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

function CampaignRow({ t, editable }: { t: EmailTemplate; editable: boolean }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (v: boolean) => api.put<EmailTemplate>(`/templates/${t.id}`, { is_active: v }),
    onSuccess: (_d, v) => {
      toast.success(`${t.name} is now ${v ? "active" : "inactive"} in the Google Sheet`);
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });
  const lints = lintTemplate(t);
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-3">
      <div className="min-w-[220px] flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/templates/${t.id}`} className="text-sm font-medium text-ink hover:text-brand-700 hover:underline">{t.campaign}</Link>
          {t.specialty && <Badge tone="neutral">{t.specialty}</Badge>}
          {lints.some((l) => l.level === "warning") && (
            <Tooltip label={lints.map((l) => l.text).join(" ")}><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></Tooltip>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-soft">{t.subject}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span>{t.is_active ? "Active" : "Inactive"}</span>
        <Switch checked={!!t.is_active} disabled={!editable || toggle.isPending} onChange={(v) => toggle.mutate(v)} />
      </div>
      <Link href={`/templates/${t.id}`}><Button size="sm" variant="outline"><Pencil className="h-3.5 w-3.5" /> {editable ? "Edit" : "View"}</Button></Link>
    </div>
  );
}

function SubjectLines({ items, editable }: { items: EmailTemplate[]; editable: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [newLine, setNewLine] = React.useState("");
  const [deleting, setDeleting] = React.useState<EmailTemplate | null>(null);
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["templates"] });
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed");
  const save = useMutation({
    mutationFn: ({ id, subject }: { id: string; subject: string }) => api.put(`/templates/${id}`, { subject }),
    onSuccess: () => { setEditing(null); done("Subject line saved to the Google Sheet"); },
    onError: fail,
  });
  const add = useMutation({
    mutationFn: () => api.post("/templates/subject-lines", { tab_id: items[0].tab_id, subject: newLine }),
    onSuccess: () => { setAdding(false); setNewLine(""); done("Subject line added to the Google Sheet"); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/templates/${id}`),
    onSuccess: () => { setDeleting(null); done("Subject line removed from the Google Sheet"); },
    onError: fail,
  });

  return (
    <Card className="mt-4">
      <CardHeader
        title={items[0].sheet_name}
        description={["The automation rotates through these subject lines, one per send.", items[0].notes].filter(Boolean).join(" ")}
        action={editable && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add line</Button>}
      />
      <CardBody className="p-0">
        <ol className="divide-y divide-line">
          {items.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-5 text-xs tabular-nums text-ink-soft">{i + 1}</span>
              {editing === t.id ? (
                <>
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={300}
                    onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) save.mutate({ id: t.id, subject: draft }); if (e.key === "Escape") setEditing(null); }} />
                  <Button size="sm" onClick={() => save.mutate({ id: t.id, subject: draft })} disabled={save.isPending || !draft.trim()}>Save</Button>
                  <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ink">{t.subject?.trim()}</span>
                  {editable && (
                    <>
                      <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => { setEditing(t.id); setDraft(t.subject ?? ""); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleting(t)} disabled={items.length <= 1}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
          {adding && (
            <li className="flex items-center gap-3 bg-brand-50/40 px-5 py-2.5">
              <span className="w-5 text-xs text-ink-soft">{items.length + 1}</span>
              <Input value={newLine} onChange={(e) => setNewLine(e.target.value)} placeholder="New subject line" autoFocus maxLength={300} />
              <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending || !newLine.trim()}>Add</Button>
              <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setAdding(false)}><X className="h-4 w-4" /></Button>
            </li>
          )}
        </ol>
      </CardBody>
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete subject line?"
        description="The row is removed from the Google Sheet. The automation stops using it from the next send."
        footer={<><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button></>}>
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-ink">{deleting?.subject}</p>
      </Dialog>
      {(() => {
        const last = items.filter((t) => t.updated_by_email).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        return last ? (
          <p className={cn("border-t border-line px-5 py-2 text-[11px] text-ink-soft")}>
            Last changed in the dashboard by {last.updated_by_email} on {formatDateTime(last.updated_at)}
          </p>
        ) : null;
      })()}
    </Card>
  );
}
