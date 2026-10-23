"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Inbox, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp, useTilt } from "@/lib/motion";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-gradient-to-r from-cream/70 via-slate-100 to-cream/70", className)} />;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-2xl bg-gradient-to-b from-cream to-slate-100 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <Icon className="h-5 w-5 text-walnut-500" />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-soft">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span className="font-medium">Could not load data.</span> {message}
      {onRetry && (
        <button className="ml-2 font-medium underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {breadcrumb && <div className="mb-1 text-xs text-ink-soft">{breadcrumb}</div>}
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "brand" | "green" | "amber" | "red" | "violet" | "sky";
}) {
  const ref = useTilt<HTMLDivElement>(4);
  const toneClass = {
    brand: "from-sage-100 to-sage-50 text-sage-700 ring-sage-200",
    green: "from-sage-100 to-sage-50 text-sage-700 ring-sage-200",
    amber: "from-glow-100 to-glow-50 text-glow-700 ring-glow-200",
    red: "from-red-100 to-red-50 text-red-700 ring-red-200",
    violet: "from-walnut-100 to-walnut-50 text-walnut-700 ring-walnut-200",
    sky: "from-sage-100 to-cream text-sage-800 ring-sage-200",
  }[tone];
  return (
    <div ref={ref} className="surface-3d group relative h-full overflow-hidden rounded-card border border-line/80 bg-white p-4 shadow-card">
      <span className="sheen" aria-hidden />
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-sage-100/60 blur-2xl transition-opacity duration-350 group-hover:opacity-100 md:opacity-60" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        {Icon && (
          <span className={cn("rounded-xl bg-gradient-to-b p-2 ring-1 ring-inset transition-transform duration-350 ease-spring group-hover:-translate-y-0.5 group-hover:rotate-[-4deg]", toneClass)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="relative mt-2 text-[28px] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums [transform:translateZ(18px)]">
        <CountUp value={value} />
      </p>
      {hint && <p className="relative mt-2 text-xs leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}

/** Animates plain whole numbers like "1,234"; anything else renders as given. */
function CountUp({ value }: { value: React.ReactNode }) {
  const numeric = typeof value === "string" && /^\d{1,3}(,\d{2,3})*$|^\d+$/.test(value) ? Number(value.replace(/,/g, "")) : null;
  const n = useCountUp(numeric);
  if (numeric === null) return <>{value}</>;
  return <>{(n ?? numeric).toLocaleString("en-IN")}</>;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-walnut-950/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-white shadow-pop focus:outline-none data-[state=open]:animate-[dialog-in_220ms_cubic-bezier(0.34,1.56,0.64,1)]",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold text-ink">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-xs text-ink-soft">{description}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-lg p-1 text-ink-soft transition-colors hover:bg-cream hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-walnut-900 px-2 py-1 text-[11px] text-walnut-50 opacity-0 shadow-pop transition-[opacity,transform] duration-150 group-hover:-translate-y-0.5 group-hover:opacity-100">
        {label}
      </span>
    </span>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-soft">
      <span>
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-1">
        <button
          className="rounded-lg border border-line bg-white px-2.5 py-1 transition-colors hover:border-sage-300 hover:bg-sage-50 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="px-2">
          Page {page} of {pages}
        </span>
        <button
          className="rounded-lg border border-line bg-white px-2.5 py-1 transition-colors hover:border-sage-300 hover:bg-sage-50 disabled:opacity-40"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-3 py-2.5 align-top text-sm text-ink", className)} {...props} />;
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-sage-500 shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]" : "bg-slate-300",
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-250 ease-spring", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
