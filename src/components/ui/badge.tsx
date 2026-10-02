import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "violet" | "sky";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  amber: "bg-amber-50 text-amber-800 ring-amber-100",
  red: "bg-red-50 text-red-700 ring-red-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  sky: "bg-sky-50 text-sky-700 ring-sky-100",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function statusTone(status?: string | null): Tone {
  const s = (status ?? "").toLowerCase();
  if (["sent", "delivered", "read", "opened", "replied", "synced", "success", "review requested", "active"].includes(s)) return "green";
  if (["failed", "error", "disabled"].includes(s)) return "red";
  if (["not sent", "duplicate", "partial", "pending", "running"].includes(s)) return "amber";
  return "neutral";
}

export function departmentTone(dept?: string | null): Tone {
  return dept === "RARE_DISEASES" ? "violet" : "sky";
}
