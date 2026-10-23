import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  // Amber Glow: reserved for the main action on a screen
  primary: "btn-amber text-white [text-shadow:0_1px_0_rgba(90,62,43,0.35)] disabled:saturate-50",
  secondary: "bg-sage-50 text-sage-800 ring-1 ring-inset ring-sage-200 hover:bg-sage-100 hover:ring-sage-300",
  outline: "border border-line bg-white/90 text-ink shadow-[0_1px_2px_rgba(41,37,31,0.05)] hover:border-sage-300 hover:bg-white hover:shadow-card",
  ghost: "text-ink-muted hover:bg-cream/70 hover:text-ink",
  danger: "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_10px_-4px_rgba(220,38,38,0.55)] hover:from-red-600 hover:to-red-700",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-2 rounded-[10px]",
  icon: "h-8 w-8 justify-center rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center font-semibold tracking-[-0.005em]",
        "transition-[transform,box-shadow,background-color,border-color,color] duration-250 ease-smooth",
        "hover:-translate-y-px active:translate-y-px active:scale-[0.98] active:duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
