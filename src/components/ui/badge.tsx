import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "violet" | "sky";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-sage-50 text-sage-800 ring-sage-200",
  green: "bg-sage-100/70 text-sage-800 ring-sage-300/70",
  amber: "bg-glow-50 text-glow-800 ring-glow-200",
  red: "bg-red-50 text-red-700 ring-red-100",
  violet: "bg-walnut-50 text-walnut-700 ring-walnut-200",
  sky: "bg-cream text-walnut-800 ring-walnut-200/70",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
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
  return dept === "RARE_DISEASES" ? "violet" : "brand";
}
