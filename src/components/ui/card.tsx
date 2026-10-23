"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTilt } from "@/lib/motion";

/**
 * Card surface. `interactive` adds the 3D layer: cursor tilt, hover lift and a
 * soft amber light reflection (desktop, fine pointer, no reduced motion only).
 */
export function Card({
  className,
  interactive,
  tilt = 2.5,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; tilt?: number }) {
  const ref = useTilt<HTMLDivElement>(interactive ? tilt : 0);
  return (
    <div
      ref={interactive ? ref : undefined}
      className={cn(
        "relative rounded-card border border-line/80 bg-white shadow-card",
        interactive && "surface-3d hover:border-sage-200",
        className,
      )}
      {...props}
    >
      {interactive && <span className="sheen" aria-hidden />}
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4", className)}>
      <div>
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
