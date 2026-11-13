"use client";

import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { useTilt } from "@/lib/motion";
import { cn, formatDate, number } from "@/lib/utils";

export interface OutreachRound {
  channel: "EMAIL" | "WHATSAPP";
  round: string;
  sent_doctors: number;
  sent_messages: number;
  failed_doctors: number;
  pending_doctors: number;
  last_sent_at: string | null;
  replies: number;
  replied_doctors: number;
  auto_replies: number;
  auto_doctors: number;
}
export interface OutreachData {
  rounds: OutreachRound[];
  totals: { email_sent_doctors: number; email_sent_messages: number; whatsapp_sent_doctors: number; whatsapp_sent_messages: number };
  reply_totals: { email_replied_doctors: number; email_auto_doctors: number; whatsapp_replied_doctors: number };
}

/** Friendly names for the rounds recorded in the sheets. */
const LABEL: Record<string, string> = {
  "1st Mail": "1st Email",
  "20th Mail": "20th Email",
  "Rare Disease intro email": "Rare Disease intro email",
  "Thank-you email": "Thank-you email",
  "Birthday / anniversary email": "Birthday & anniversary email",
  WhatsApp: "WhatsApp message",
  "FDA drug communication": "FDA drug update",
};
const ORDER = ["1st Mail", "20th Mail"];

function sortRounds(rs: OutreachRound[]) {
  return [...rs].sort((a, b) => {
    const ia = ORDER.indexOf(a.round), ib = ORDER.indexOf(b.round);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return b.sent_doctors - a.sent_doctors;
  });
}

function pct(a: number, b: number) {
  if (!b) return "—";
  const v = (100 * a) / b;
  return `${v < 1 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
}

function Line({ dot, label, value, strong }: { dot: string; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="flex items-center gap-2 text-[12.5px] text-ink-muted"><span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />{label}</span>
      <span className={cn("tabular-nums text-[13px]", strong ? "font-bold text-ink" : "font-semibold text-ink")}>{value}</span>
    </div>
  );
}

function RoundCard({ r, href }: { r: OutreachRound; href: string }) {
  const ref = useTilt<HTMLAnchorElement>(3);
  const isEmail = r.channel === "EMAIL";
  return (
    <Link ref={ref} href={href} className="surface-3d group relative block overflow-hidden rounded-card border border-line/80 bg-white p-4 shadow-card focus-visible:ring-2 focus-visible:ring-glow-400">
      <span className="sheen" aria-hidden />
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-walnut-800">{LABEL[r.round] ?? r.round}</p>
        <span className={cn("rounded-lg p-1.5", isEmail ? "bg-sage-50 text-sage-700" : "bg-glow-50 text-glow-700")}>
          {isEmail ? <Mail className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
        </span>
      </div>
      <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums">{number(r.sent_doctors)}</p>
      <p className="mt-1 text-xs text-ink-soft">doctors {isEmail ? "received this email" : "received this message"}</p>
      <div className="mt-3 divide-y divide-dashed divide-line/80 border-t border-line/70 pt-1">
        <Line dot="bg-sage-500" label="Replied" value={`${number(r.replied_doctors)} doctor${r.replied_doctors === 1 ? "" : "s"} · ${pct(r.replied_doctors, r.sent_doctors)}`} strong />
        {isEmail && <Line dot="bg-slate-300" label="Automatic reply (out of office etc.)" value={number(r.auto_doctors)} />}
        {r.failed_doctors > 0 && <Line dot="bg-red-500" label="Could not be sent" value={number(r.failed_doctors)} />}
        {r.pending_doctors > 0 && <Line dot="bg-glow-500" label="Not sent yet" value={number(r.pending_doctors)} />}
      </div>
      {r.last_sent_at && <p className="mt-2 text-[11px] text-ink-soft">Last sent {formatDate(r.last_sent_at)}</p>}
    </Link>
  );
}

function TotalCard({ channel, sentDoctors, sentMessages, replied, auto }: { channel: "EMAIL" | "WHATSAPP"; sentDoctors: number; sentMessages: number; replied: number; auto?: number }) {
  const isEmail = channel === "EMAIL";
  return (
    <div className={cn("relative overflow-hidden rounded-card border p-4 shadow-card",
      isEmail ? "border-sage-200 bg-gradient-to-br from-sage-50 to-white" : "border-glow-200 bg-gradient-to-br from-glow-50 to-white")}>
      <p className="text-sm font-bold text-walnut-800">{isEmail ? "All emails together" : "All WhatsApp together"}</p>
      <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums">{number(sentMessages)}</p>
      <p className="mt-1 text-xs text-ink-soft">{isEmail ? "emails sent" : "messages sent"} to {number(sentDoctors)} different doctors</p>
      <div className="mt-3 divide-y divide-dashed divide-line/80 border-t border-line/70 pt-1">
        <Line dot="bg-sage-500" label="Doctors who replied" value={`${number(replied)} · ${pct(replied, sentDoctors)}`} strong />
        {auto !== undefined && <Line dot="bg-slate-300" label="Automatic replies" value={`${number(auto)} doctors`} />}
      </div>
    </div>
  );
}

/** Clear picture of outreach: per email / WhatsApp round, who received it and who replied. */
export function OutreachSummary({ data }: { data: OutreachData }) {
  const emails = sortRounds(data.rounds.filter((r) => r.channel === "EMAIL"));
  const whatsapp = sortRounds(data.rounds.filter((r) => r.channel === "WHATSAPP"));
  return (
    <section className="mt-6 space-y-6">
      <div>
        <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-walnut-800">Emails: who received them and who replied</h2>
            <p className="text-xs text-ink-soft">Counted per doctor. A reply is counted under the last email that doctor received before replying.</p>
          </div>
          <Link href="/doctors?reply=email" className="text-xs font-semibold text-sage-700 hover:underline">See doctors who replied →</Link>
        </div>
        <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {emails.map((r) => <RoundCard key={r.round} r={r} href="/doctors?reply=email" />)}
          <TotalCard channel="EMAIL" sentDoctors={data.totals.email_sent_doctors} sentMessages={data.totals.email_sent_messages}
            replied={data.reply_totals.email_replied_doctors} auto={data.reply_totals.email_auto_doctors} />
        </div>
      </div>

      {(whatsapp.length > 0 || data.totals.whatsapp_sent_messages > 0) && (
        <div>
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-walnut-800">WhatsApp: who received it and who replied</h2>
              <p className="text-xs text-ink-soft">Replies appear once Cunnekt sends incoming messages to the dashboard, or the sheet&apos;s WhatsApp Reply column is filled.</p>
            </div>
            <Link href="/doctors?reply=whatsapp" className="text-xs font-semibold text-sage-700 hover:underline">See doctors who replied →</Link>
          </div>
          <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {whatsapp.map((r) => <RoundCard key={r.round} r={r} href="/doctors?reply=whatsapp" />)}
            <TotalCard channel="WHATSAPP" sentDoctors={data.totals.whatsapp_sent_doctors} sentMessages={data.totals.whatsapp_sent_messages}
              replied={data.reply_totals.whatsapp_replied_doctors} />
          </div>
        </div>
      )}
    </section>
  );
}
