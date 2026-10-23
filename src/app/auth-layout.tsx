import * as React from "react";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-walnut-700 via-walnut-700 to-walnut-900 p-12 text-white lg:flex">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 animate-float rounded-full bg-glow-500/25 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 animate-float rounded-full bg-sage-400/25 blur-3xl [animation-delay:-3s]" />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-glow-300 via-glow-500 to-glow-700 text-base font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_-6px_rgba(213,133,31,0.8)]">IK</div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-glow-200">Ikris Pharma Network</p>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-[42px] font-extrabold leading-tight tracking-[-0.03em]">IKRIS Doctor Connect</h1>
          <p className="mt-4 text-base leading-relaxed text-walnut-100">Doctor Relationship &amp; Outreach Management Platform</p>
          <div className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-sm text-walnut-100">
            <div><p className="text-lg font-bold text-white">NPP</p><p className="mt-1 text-xs">Oncology &amp; Hematology</p></div>
            <div><p className="text-lg font-bold text-white">Rare Diseases</p><p className="mt-1 text-xs">All specialties</p></div>
            <div><p className="text-lg font-bold text-white">Outreach</p><p className="mt-1 text-xs">Email, WhatsApp, feedback</p></div>
          </div>
        </div>
        <p className="relative text-xs text-walnut-200">India · Bulgaria · Belgium · Hong Kong</p>
      </div>
      <div className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm animate-rise rounded-[20px] border border-line/80 bg-white p-7 shadow-lift">
          <div className="mb-8 lg:hidden">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-glow-700">Ikris Pharma Network</p>
            <p className="mt-1 text-xl font-semibold text-ink">IKRIS Doctor Connect</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
