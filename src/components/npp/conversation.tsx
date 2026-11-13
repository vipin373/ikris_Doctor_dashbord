"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { CategoryBadge } from "@/components/npp/shared";
import { Badge, statusTone } from "@/components/ui/badge";
import { Dialog, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, formatDateTime, number } from "@/lib/utils";

interface Conversation {
  doctor: { id: string; doctor_name: string; category: string | null; specialty: string | null; institute: string | null; city: string | null; state: string | null; country: string | null; email: string | null; whatsapp_number: string | null; last_contact_at: string | null; last_reply_at: string | null };
  stats: { emails_sent: number; emails_delivered: number; email_replies: number; whatsapp_sent: number; whatsapp_replies: number; engagement: string };
  events: { id: number; channel: string; direction: string; event_type: string; status: string; subject: string | null; detail: string | null; campaign: string | null; occurred_at: string | null; category_at_send: string | null }[];
}

export function ConversationDialog({ doctorId, onClose }: { doctorId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["npp-conversation", doctorId],
    queryFn: () => api.get<Conversation>(`/npp/doctors/${doctorId}/conversation`),
    enabled: !!doctorId,
  });
  return (
    <Dialog open={!!doctorId} onOpenChange={(v) => !v && onClose()} wide title={data?.doctor.doctor_name ?? "Conversation"}
      description={data ? [data.doctor.specialty, data.doctor.institute, data.doctor.city, data.doctor.country].filter(Boolean).join(" · ") : undefined}>
      {isLoading || !data ? <Skeleton className="h-60" /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CategoryBadge category={data.doctor.category} />
            <Badge tone={data.stats.engagement === "Engaged" ? "green" : data.stats.engagement === "Awaiting reply" ? "amber" : "neutral"}>{data.stats.engagement}</Badge>
            {data.doctor.email && <span className="text-ink-soft">{data.doctor.email}</span>}
            {data.doctor.whatsapp_number && <span className="text-ink-soft">· WhatsApp {data.doctor.whatsapp_number}</span>}
            <Link href={`/doctors/${data.doctor.id}`} className="ml-auto font-semibold text-sage-700 hover:underline">Full profile →</Link>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[["Emails sent", data.stats.emails_sent], ["Delivered", data.stats.emails_delivered], ["Email replies", data.stats.email_replies],
              ["WhatsApp sent", data.stats.whatsapp_sent], ["WhatsApp replies", data.stats.whatsapp_replies]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-line bg-white px-2 py-1.5 text-center"><p className="text-[10.5px] text-ink-soft">{l}</p><p className="text-base font-bold tabular-nums">{number(v as number)}</p></div>
            ))}
            <div className="rounded-xl border border-line bg-white px-2 py-1.5 text-center"><p className="text-[10.5px] text-ink-soft">Last reply</p><p className="text-[11px] font-semibold">{data.doctor.last_reply_at ? formatDateTime(data.doctor.last_reply_at) : "—"}</p></div>
          </div>
          <ol className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {data.events.map((e) => {
              const inbound = e.direction === "INBOUND";
              return (
                <li key={e.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
                  <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-card", inbound ? "rounded-bl-md border border-glow-200 bg-glow-50/70" : "rounded-br-md border border-line bg-white")}>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
                      {inbound ? <ArrowDownLeft className="h-3 w-3 text-glow-600" /> : <ArrowUpRight className="h-3 w-3 text-sage-600" />}
                      <span className="font-semibold">{e.channel === "EMAIL" ? "Email" : "WhatsApp"} · {e.event_type}</span>
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                      {e.category_at_send && <span>· sent as Category {e.category_at_send}</span>}
                      <span>· {e.occurred_at ? formatDateTime(e.occurred_at) : "date not recorded"}</span>
                    </div>
                    {e.subject && <p className="mt-1 font-medium">{e.subject}</p>}
                    {e.detail && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed">{e.detail}</p>}
                    {e.campaign && <p className="mt-1 text-[11px] text-ink-soft">{e.campaign}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Dialog>
  );
}
