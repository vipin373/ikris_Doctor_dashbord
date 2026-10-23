import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-[10px] border border-line bg-white shadow-[inset_0_1px_2px_rgba(41,37,31,0.04)] transition-[border-color,box-shadow] duration-200 px-3 text-sm text-ink placeholder:text-ink-soft focus:border-sage-400 focus:outline-none focus:ring-[3px] focus:ring-sage-200/60 disabled:bg-slate-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full rounded-[10px] border border-line bg-white shadow-[inset_0_1px_2px_rgba(41,37,31,0.04)] transition-[border-color,box-shadow] duration-200 px-2.5 text-sm text-ink focus:border-sage-400 focus:outline-none focus:ring-[3px] focus:ring-sage-200/60",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-medium text-ink-muted", className)} {...props} />;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-[10px] border border-line bg-white shadow-[inset_0_1px_2px_rgba(41,37,31,0.04)] transition-[border-color,box-shadow] duration-200 px-3 py-2 text-sm text-ink focus:border-sage-400 focus:outline-none focus:ring-[3px] focus:ring-sage-200/60",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
