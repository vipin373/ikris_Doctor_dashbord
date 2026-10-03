"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Code2, ExternalLink, Eye, Info, Link2Off, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, Skeleton, Switch } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api";
import { fillSample, lintTemplate, mergeTags, previewDocument, SAMPLE_DOCTOR, sheetLink } from "@/lib/templates";
import type { EmailTemplate } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDateTime } from "@/lib/utils";

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const qc = useQueryClient();
  const { data: t, isLoading, error, refetch } = useQuery({
    queryKey: ["template", id],
    queryFn: () => api.get<EmailTemplate>(`/templates/${id}`),
  });
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [active, setActive] = React.useState<boolean | null>(null);
  const [view, setView] = React.useState<"preview" | "html">("preview");
  const [confirm, setConfirm] = React.useState(false);

  React.useEffect(() => {
    if (!t) return;
    setSubject(t.subject ?? "");
    setBody(t.body_html ?? "");
    setActive(t.is_active);
  }, [t]);

  const dirty = !!t && (subject !== (t.subject ?? "") || body !== (t.body_html ?? "") || active !== t.is_active);
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      if (t?.subject_cell && subject !== (t.subject ?? "")) payload.subject = subject;
      if (t?.body_cell && body !== (t.body_html ?? "")) payload.body_html = body;
      if (t?.active_cell && active !== t.is_active) payload.is_active = active;
      return api.put<EmailTemplate>(`/templates/${id}`, payload);
    },
    onSuccess: () => {
      setConfirm(false);
      toast.success("Saved to the Google Sheet. The next automated email uses this version.");
      qc.invalidateQueries({ queryKey: ["template", id] });
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(e instanceof Error ? e.message : "Save failed");
    },
  });

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return <Card><EmptyState title="Template not found" description="It may have been removed from the Google Sheet, or it belongs to another department." /></Card>;
    }
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }
  if (isLoading || !t) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-[480px]" /></div>;

  const editable = !!t.editable;
  const lints = lintTemplate({ subject, body_html: body, kind: t.kind });
  const tags = mergeTags(`${subject} ${body}`);

  return (
    <div className="space-y-5">
      <Link href="/templates" className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Email Templates
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{t.name}</h1>
            <Badge tone={departmentTone(t.department)}>{DEPARTMENT_LABEL[t.department]}</Badge>
            {t.active_cell && <Badge tone={active ? "green" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>}
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {t.source_name} → {t.sheet_name}
            {t.subject_cell && <> · subject in {t.subject_cell}</>}
            {t.body_cell && <> · body in {t.body_cell}</>}
            {" · "}synced {formatDateTime(t.last_synced_at)}
            {t.updated_by_email && <> · last changed here by {t.updated_by_email}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={sheetLink(t)} target="_blank" rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-slate-50">
            Open in sheet <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {editable && (
            <>
              <Button variant="outline" disabled={!dirty || save.isPending}
                onClick={() => { setSubject(t.subject ?? ""); setBody(t.body_html ?? ""); setActive(t.is_active); }}>
                <Undo2 className="h-4 w-4" /> Discard
              </Button>
              <Button disabled={!dirty || save.isPending} onClick={() => setConfirm(true)}>
                <Save className="h-4 w-4" /> Save to Google Sheet
              </Button>
            </>
          )}
        </div>
      </div>

      {!editable && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Link2Off className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            View only. Editing from the dashboard is not connected for this Google Sheet yet.{" "}
            {me?.role === "ADMIN"
              ? <Link href="/google-sheets" className="font-semibold underline">Connect it in Google Sheets Sync Center</Link>
              : "Ask an administrator to connect it."}
          </span>
        </div>
      )}

      {lints.map((l) => (
        <div key={l.text} className={cn("flex items-start gap-2 rounded-lg border px-4 py-2.5 text-xs",
          l.level === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-white text-ink-muted")}>
          {l.level === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {l.text}
        </div>
      ))}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Template" description={editable ? "Edit the subject and the HTML body. Merge tags like {{DoctorName}} are filled per doctor by the automation." : undefined} />
          <CardBody className="space-y-4">
            {t.active_cell && (
              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-ink">Active</p>
                  <p className="text-xs text-ink-soft">Only active campaigns are sent by the automation.</p>
                </div>
                <Switch checked={!!active} disabled={!editable} onChange={setActive} />
              </div>
            )}
            {t.subject_cell && (
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} maxLength={1000} />
              </div>
            )}
            {t.body_cell && (
              <div>
                <Label htmlFor="body">Body (HTML)</Label>
                <Textarea id="body" rows={22} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable}
                  spellCheck={false} className="font-mono text-[12px] leading-relaxed" />
                <p className="mt-1 text-[11px] text-ink-soft">{body.length.toLocaleString("en-IN")} characters</p>
              </div>
            )}
            <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-ink-muted">
              <span className="font-medium text-ink">Merge tags in this template:</span>{" "}
              {tags.length ? tags.map((m) => `{{${m}}}`).join("  ") : "none"}
              {t.notes && <p className="mt-1 whitespace-pre-line">{t.notes}</p>}
            </div>
          </CardBody>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Preview"
            description={`As a doctor would see it, with sample values (${SAMPLE_DOCTOR.name}, ${SAMPLE_DOCTOR.specialization}).`}
            action={
              <div className="flex rounded-md border border-line p-0.5 text-xs">
                <button onClick={() => setView("preview")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1", view === "preview" && "bg-brand-50 text-brand-800")}>
                  <Eye className="h-3.5 w-3.5" /> Email
                </button>
                <button onClick={() => setView("html")} className={cn("inline-flex items-center gap-1 rounded px-2 py-1", view === "html" && "bg-brand-50 text-brand-800")}>
                  <Code2 className="h-3.5 w-3.5" /> Source
                </button>
              </div>
            }
          />
          <div className="border-b border-line bg-slate-50 px-5 py-2.5 text-sm">
            <span className="text-ink-soft">Subject: </span>
            <span className="font-medium text-ink">{subject.trim() ? fillSample(subject, false) : <span className="italic text-ink-soft">from the Subject Lines rotation</span>}</span>
          </div>
          <div className="min-h-[520px] flex-1">
            {t.kind === "subject_line" ? (
              <p className="p-5 text-sm text-ink-muted">Subject line only. It is paired with the body of the template being sent.</p>
            ) : view === "preview" ? (
              body.trim() ? (
                <iframe title="Email preview" sandbox="" srcDoc={previewDocument(body)} className="h-full min-h-[520px] w-full bg-white" />
              ) : (
                <EmptyState title="This template is empty" description={editable ? "Write a subject and body on the left, then save." : undefined} />
              )
            ) : (
              <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-[11px] text-ink">{body}</pre>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm} title="Save to the Google Sheet?"
        description="This overwrites the template in the sheet. The next automated email to doctors uses the new version."
        footer={<><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button></>}>
        <ul className="space-y-1 text-sm text-ink">
          {subject !== (t.subject ?? "") && <li>• Subject changed</li>}
          {body !== (t.body_html ?? "") && <li>• Body changed ({(t.body_html ?? "").length.toLocaleString("en-IN")} → {body.length.toLocaleString("en-IN")} characters)</li>}
          {active !== t.is_active && <li>• Campaign set to {active ? "active" : "inactive"}</li>}
        </ul>
        <p className="mt-3 text-xs text-ink-soft">Sheet: {t.source_name} → {t.sheet_name}</p>
      </Dialog>
    </div>
  );
}
