"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog } from "@/components/ui/misc";
import {
  AlertTriangle, ArrowLeft, Building2, CalendarDays, ChevronDown, ChevronRight, FileSpreadsheet, Mail, MapPin,
  MessageCircle, Pencil, Phone, Send, UserRound,
} from "lucide-react";
import { Badge, departmentTone, statusTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton, Tooltip } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/api";
import type { CommEvent, Doctor, SourceRow } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDate, formatDateTime, formatDayMonth, ISSUE_LABEL, whatsappLink } from "@/lib/utils";

type DoctorDetail = { doctor: Doctor; sources: SourceRow[]; events: CommEvent[] };

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value || <span className="text-ink-soft">Not in sheet</span>}</dd>
    </div>
  );
}

export default function DoctorProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["doctor", id],
    queryFn: () => api.get<DoctorDetail>(`/doctors/${id}`),
  });

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <Card>
          <EmptyState title="Doctor not found" description="This doctor does not exist or belongs to a department you cannot access." />
        </Card>
      );
    }
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const { doctor: d, sources, events } = data;
  const wa = whatsappLink(d.whatsapp_number || d.contact_number);
  const deptPath = d.department === "NPP" ? "/npp" : "/rare-diseases";
  const extra = Object.entries(d.extra || {});

  return (
    <div className="space-y-5">
      <Link href="/doctors" className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Doctors
      </Link>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-800">
              <UserRound className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink">{d.doctor_name}</h1>
              <p className="mt-0.5 text-sm text-ink-muted">
                {[d.qualification, d.specialty].filter(Boolean).join(" · ") || "Specialty not in sheet"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                {d.institute && <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{d.institute}</span>}
                {(d.city || d.state) && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[d.city, d.state].filter(Boolean).join(", ")}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Link href={deptPath}><Badge tone={departmentTone(d.department)}>{DEPARTMENT_LABEL[d.department]}</Badge></Link>
                {d.sub_department && <Badge tone="neutral">{d.sub_department}</Badge>}
                {d.category && <Badge tone="brand">Category {d.category}</Badge>}
                {d.bdm && <Badge tone="neutral">BDM: {d.bdm}</Badge>}
                {d.nsm && <Badge tone="neutral">NSM: {d.nsm}</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={d.email ? `mailto:${d.email}` : undefined}
              className={cn("inline-flex h-9 items-center gap-2 rounded-md bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-700", !d.email && "pointer-events-none opacity-40")}>
              <Mail className="h-4 w-4" /> Send Email
            </a>
            <a href={wa ?? undefined} target="_blank" rel="noreferrer"
              className={cn("inline-flex h-9 items-center gap-2 rounded-md border border-line px-4 text-sm font-medium text-ink hover:bg-slate-50", !wa && "pointer-events-none opacity-40")}>
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
            <a href={wa ? `tel:${d.contact_number}` : undefined}
              className={cn("inline-flex h-9 items-center gap-2 rounded-md border border-line px-4 text-sm font-medium text-ink hover:bg-slate-50", !wa && "pointer-events-none opacity-40")}>
              <Phone className="h-4 w-4" /> Call
            </a>
          </div>
        </div>
        {d.data_issues?.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-medium">Data quality:</span>
            {d.data_issues.map((i) => <span key={i} className="rounded bg-white/70 px-1.5 py-0.5">{ISSUE_LABEL[i] ?? i}</span>)}
            <span className="text-amber-800/80">Fix these in the Google Sheet; the next sync updates this profile.</span>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Basic & business information" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
                <Field label="Doctor name" value={d.doctor_name} />
                <Field label="Qualification" value={d.qualification} />
                <Field label="Specialty" value={d.specialty} />
                <Field label="Department" value={DEPARTMENT_LABEL[d.department]} />
                <Field label="Sub-department" value={d.sub_department} />
                <Field label="Category" value={d.category && `Category ${d.category}`} />
                <Field label="BDM" value={d.bdm} />
                <Field label="NSM" value={d.nsm} />
                <Field label="S.No. in sheet" value={d.s_no} />
                <Field label="Institute" value={d.institute} />
                <Field label="Institute address" value={d.institute_address} />
                <Field label="City / State" value={[d.city, d.state, d.country].filter(Boolean).join(", ")} />
              </dl>
              {extra.length > 0 && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-soft">Other columns from the sheet</p>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
                    {extra.map(([k, v]) => <Field key={k} label={k} value={v} />)}
                  </dl>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity timeline" description="Every recorded communication with this doctor, newest first" />
            <CardBody>
              {events.length === 0 ? (
                <EmptyState icon={Send} title="No communication recorded yet" />
              ) : (
                <ol className="relative space-y-5 border-l border-line pl-6">
                  {events.map((e) => (
                    <li key={e.id} className="relative">
                      <span className={cn(
                        "absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white",
                        statusTone(e.status) === "green" ? "bg-emerald-500" : statusTone(e.status) === "red" ? "bg-red-500" : "bg-amber-400",
                      )} />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-ink">
                          {e.channel === "EMAIL" ? "Email" : e.channel === "WHATSAPP" ? "WhatsApp" : e.channel} · {e.event_type}
                        </span>
                        <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                        <span className="text-xs text-ink-soft">{e.occurred_at ? formatDateTime(e.occurred_at) : "Date not recorded in sheet"}</span>
                      </div>
                      {e.subject && <p className="mt-1 text-sm text-ink">Subject: {e.subject}</p>}
                      {e.campaign && <p className="mt-0.5 text-xs text-ink-soft">Campaign: {e.campaign}</p>}
                      {e.detail && <p className="mt-0.5 text-xs text-ink-muted">{e.detail}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            <CardBody>
              <dl className="space-y-3">
                <Field label="Email" value={d.email && (d.email_norm ? <a className="text-brand-700 hover:underline" href={`mailto:${d.email}`}>{d.email}</a> : <span>{d.email} <Badge tone="red">invalid</Badge></span>)} />
                <Field label="Contact number" value={d.contact_number} />
                <Field label="WhatsApp" value={d.whatsapp_number} />
              </dl>
            </CardBody>
          </Card>

          <ImportantDates doctor={d} />

          <Card>
            <CardHeader title="Engagement" description="Measured from recorded activity" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Emails sent" value={String(d.emails_sent)} />
                <Field label="WhatsApp messages" value={String(d.whatsapp_sent)} />
                <Field label="Replies" value="0" />
                <Field label="Last contact" value={d.last_contact_at ? formatDate(d.last_contact_at) : d.last_contact_status ? "Date not recorded" : "Never"} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Source" description="Google Sheet rows behind this profile" />
            <CardBody className="space-y-3">
              {sources.map((s, i) => <SourceCard key={i} source={s} department={d.department} />)}
              <p className="text-[11px] text-ink-soft">Profile last synced {formatDateTime(d.last_synced_at)}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SourceCard({ source: s, department }: { source: SourceRow; department: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-md border border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <span className="flex-1">
          <span className="block text-xs font-medium text-ink">
            {DEPARTMENT_LABEL[department]} → {s.source_name ?? "Google Sheet"} / {s.sheet_name}
          </span>
          <span className="block text-[11px] text-ink-soft">Row {s.row_number} · synced {formatDateTime(s.last_synced_at)}</span>
          {s.missing_from_source && (
            <Tooltip label="This row was not found in the last sync. It is kept, not deleted.">
              <Badge tone="amber" className="mt-1">No longer in sheet</Badge>
            </Tooltip>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-ink-soft" /> : <ChevronRight className="h-4 w-4 text-ink-soft" />}
      </button>
      {open && (
        <div className="border-t border-line bg-slate-50/70 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Original values</p>
          <dl className="space-y-1">
            {Object.entries(s.raw_data).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2 text-[11px]">
                <dt className="truncate text-ink-soft" title={k}>{k}</dt>
                <dd className="break-words text-ink">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <a className="mt-2 inline-block text-[11px] font-medium text-brand-700 hover:underline" target="_blank" rel="noreferrer"
            href={`https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}/edit`}>
            Open sheet ↗
          </a>
        </div>
      )}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function splitDate(value: string | null) {
  if (!value) return { day: "", month: "", year: "" };
  const [y, m, dd] = value.split("-");
  return { day: String(Number(dd)), month: String(Number(m)), year: y === "1904" ? "" : y };
}

function joinDate(p: { day: string; month: string; year: string }): string | null {
  if (!p.day || !p.month) return null;
  const y = p.year ? p.year.padStart(4, "0") : "1904";
  return `${y}-${p.month.padStart(2, "0")}-${p.day.padStart(2, "0")}`;
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  const { year } = splitDate(value);
  return year ? `${formatDayMonth(value)} ${year}` : formatDayMonth(value);
}

type DateParts = ReturnType<typeof splitDate>;

function DatePicker({ value, onChange, label }: { value: DateParts; onChange: (v: DateParts) => void; label: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        <Select value={value.day} onChange={(e) => onChange({ ...value, day: e.target.value })}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}
        </Select>
        <Select value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </Select>
        <Input value={value.year} inputMode="numeric" maxLength={4} placeholder="Year (optional)"
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, "") })} />
      </div>
    </div>
  );
}

function ImportantDates({ doctor: d }: { doctor: Doctor }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [dob, setDob] = React.useState(splitDate(d.date_of_birth));
  const [ann, setAnn] = React.useState(splitDate(d.date_of_anniversary));
  const save = useMutation({
    mutationFn: () => api.put(`/doctors/${d.id}/dates`, { date_of_birth: joinDate(dob), date_of_anniversary: joinDate(ann) }),
    onSuccess: () => {
      toast.success("Dates saved");
      qc.invalidateQueries({ queryKey: ["doctor", d.id] });
      qc.invalidateQueries({ queryKey: ["upcoming-dates"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  const manual = d.manual_fields ?? {};
  return (
    <Card>
      <CardHeader title="Important dates" action={<Button size="sm" variant="ghost" onClick={() => { setDob(splitDate(d.date_of_birth)); setAnn(splitDate(d.date_of_anniversary)); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>} />
      <CardBody>
        <dl className="grid grid-cols-2 gap-4">
          <Field label="Birthday" value={d.date_of_birth && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-ink-soft" />{dateLabel(d.date_of_birth)}</span>} />
          <Field label="Anniversary" value={dateLabel(d.date_of_anniversary)} />
        </dl>
        {(manual.date_of_birth || manual.date_of_anniversary) && <p className="mt-3 text-[11px] text-ink-soft">Entered in the dashboard.</p>}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen} title="Important dates" description="Shown on the Calendar and in upcoming birthdays. If the Google Sheet later gets a date for this doctor, the sheet value is used."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></>}>
        <div className="space-y-4">
          <DatePicker label="Date of birth" value={dob} onChange={setDob} />
          <DatePicker label="Date of anniversary" value={ann} onChange={setAnn} />
          <p className="text-[11px] text-ink-soft">Leave day and month empty to clear a date. The year is optional.</p>
        </div>
      </Dialog>
    </Card>
  );
}
