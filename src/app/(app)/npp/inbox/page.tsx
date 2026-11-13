"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, Mail, MailOpen, MessageCircle, Search } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CategoryBadge } from "@/components/npp/shared";
import { ConversationDialog } from "@/components/npp/conversation";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Dialog, EmptyState, PageHeader, Pagination, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Facets } from "@/lib/types";
import { cn, formatDateTime, number } from "@/lib/utils";

type Channel = "EMAIL" | "WHATSAPP";
interface Reply {
  id: number; doctor_id: string; channel: Channel; status: string; subject: string | null; detail: string | null; campaign: string | null;
  occurred_at: string | null; read_at: string | null;
  doctors: { doctor_name: string; category: string | null; specialty: string | null; institute: string | null; city: string | null; email: string | null; whatsapp_number: string | null };
}

export default function InboxPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [channel, setChannel] = React.useState<Channel>("EMAIL");
  const [f, setF] = React.useState({ category: "", read: "", kind: "", specialty: "", date_from: "", date_to: "", q: "" });
  const [dq, setDq] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<Reply | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setDq(f.q.trim()), 300); return () => clearTimeout(t); }, [f.q]);
  React.useEffect(() => setPage(1), [channel, f.category, f.read, f.kind, f.specialty, f.date_from, f.date_to, dq]);
  const { data: facets } = useQuery({ queryKey: ["facets"], queryFn: () => api.get<Facets>("/doctors/facets") });
  const { data, isLoading } = useQuery({
    queryKey: ["npp-inbox", channel, f.category, f.read, f.kind, f.specialty, f.date_from, f.date_to, dq, page],
    queryFn: () => api.get<{ items: Reply[]; total: number; unread: Record<Channel, number> }>("/npp/inbox", {
      channel, category: f.category || undefined, read: f.read || undefined, kind: f.kind || undefined, specialty: f.specialty || undefined,
      date_from: f.date_from || undefined, date_to: f.date_to || undefined, q: dq || undefined, page, page_size: 30,
    }),
  });
  const mark = useMutation({
    mutationFn: ({ ids, read }: { ids: number[]; read: boolean }) => api.post("/npp/inbox/read", { ids, read }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["npp-inbox"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  if (me && !me.departments.includes("NPP")) return <Card><EmptyState title="No access" description="The reply inbox is for NPP." /></Card>;
  const items = data?.items ?? [];
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const openReply = (r: Reply) => { setOpen(r); if (!r.read_at) mark.mutate({ ids: [r.id], read: true }); };

  return (
    <div>
      <PageHeader breadcrumb={<Link href="/npp" className="hover:underline">NPP</Link>} title="Doctor Communication & Replies"
        description="Every email and WhatsApp reply matched to its doctor. Email replies come from the MSL sheet's Email Reply column; WhatsApp replies arrive from Cunnekt."
        actions={unreadOnPage(items) > 0 && <Button variant="outline" onClick={() => mark.mutate({ ids: items.filter((i) => !i.read_at).map((i) => i.id), read: true })}>
          <MailOpen className="h-4 w-4" /> Mark page as read</Button>} />

      <div className="mb-4 flex gap-2" role="tablist">
        {(["EMAIL", "WHATSAPP"] as const).map((c) => (
          <button key={c} role="tab" aria-selected={channel === c} onClick={() => setChannel(c)}
            className={cn("flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
              channel === c ? "border-sage-300 bg-white text-sage-800 shadow-card ring-2 ring-sage-200" : "border-line bg-white/60 text-ink-muted hover:bg-white")}>
            {c === "EMAIL" ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            {c === "EMAIL" ? "Email replies" : "WhatsApp replies"}
            {!!data?.unread[c] && <span className="rounded-full bg-glow-500 px-1.5 text-[10.5px] font-bold text-white">{data.unread[c]}</span>}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3">
          <div className="relative min-w-[200px] flex-1 md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search reply text or doctor…" className="pl-9" />
          </div>
          <Select className="w-auto" value={f.category} onChange={(e) => set("category", e.target.value)} aria-label="Category">
            <option value="">All categories</option><option value="A">Category A</option><option value="B">Category B</option><option value="C">Category C</option><option value="none">Unassigned</option>
          </Select>
          <Select className="w-auto" value={f.read} onChange={(e) => set("read", e.target.value)} aria-label="Read status">
            <option value="">Read & unread</option><option value="unread">Unread</option><option value="read">Read</option>
          </Select>
          <Select className="w-auto" value={f.kind} onChange={(e) => set("kind", e.target.value)} aria-label="Reply type">
            <option value="">Replies & auto-replies</option><option value="replied">Real replies</option><option value="auto">Auto-replies</option>
          </Select>
          <Select className="w-auto" value={f.specialty} onChange={(e) => set("specialty", e.target.value)} aria-label="Specialization">
            <option value="">All specializations</option>{(facets?.specialties ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input type="date" className="w-auto" value={f.date_from} onChange={(e) => set("date_from", e.target.value)} aria-label="From date" />
          <Input type="date" className="w-auto" value={f.date_to} onChange={(e) => set("date_to", e.target.value)} aria-label="To date" />
        </div>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : items.length === 0 ? (
          <EmptyState icon={Inbox} title="No replies here" description={channel === "WHATSAPP" ? "WhatsApp replies appear once Cunnekt sends them to the dashboard webhook." : "Email replies appear when the sheet's Email Reply column is filled and synced."} />
        ) : (
          <ul className="divide-y divide-line/70">
            {items.map((r) => (
              <li key={r.id} className={cn("flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-cream/40", !r.read_at && "bg-glow-50/40")}
                onClick={() => openReply(r)}>
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", r.read_at ? "bg-transparent" : "bg-glow-500 shadow-[0_0_6px_rgba(213,133,31,0.7)]")} aria-label={r.read_at ? "Read" : "Unread"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm", r.read_at ? "font-medium text-ink" : "font-bold text-ink")}>{r.doctors.doctor_name}</span>
                    <CategoryBadge category={r.doctors.category} />
                    <Badge tone={r.status === "Replied" ? "green" : "neutral"}>{r.status}</Badge>
                    <span className="text-xs text-ink-soft">{r.doctors.institute}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-muted">{r.detail || "(no text)"}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-ink-soft">
                  <p>{r.occurred_at ? formatDateTime(r.occurred_at) : "Date not recorded"}</p>
                  <button className="mt-1 hover:text-ink" onClick={(e) => { e.stopPropagation(); mark.mutate({ ids: [r.id], read: !r.read_at }); }}>
                    Mark {r.read_at ? "unread" : "read"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 30 && <Pagination page={page} pageSize={30} total={data.total} onPage={setPage} />}
      </Card>

      <ConversationDialog doctorId={open?.doctor_id ?? null} onClose={() => setOpen(null)} />
    </div>
  );
}

function unreadOnPage(items: Reply[]) { return items.filter((i) => !i.read_at).length; }

