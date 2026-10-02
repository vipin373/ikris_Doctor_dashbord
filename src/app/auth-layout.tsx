import * as React from "react";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-800 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-base font-bold">IK</div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-100">Ikris Pharma Network</p>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">IKRIS Doctor Connect</h1>
          <p className="mt-4 text-base leading-relaxed text-brand-100">Doctor Relationship &amp; Outreach Management Platform</p>
          <div className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-sm text-brand-100">
            <div><p className="text-lg font-semibold text-white">NPP</p><p className="mt-1 text-xs">Oncology &amp; Hematology</p></div>
            <div><p className="text-lg font-semibold text-white">Rare Diseases</p><p className="mt-1 text-xs">All specialties</p></div>
            <div><p className="text-lg font-semibold text-white">Outreach</p><p className="mt-1 text-xs">Email, WhatsApp, feedback</p></div>
          </div>
        </div>
        <p className="relative text-xs text-brand-200">India · Bulgaria · Belgium · Hong Kong</p>
      </div>
      <div className="flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">Ikris Pharma Network</p>
            <p className="mt-1 text-xl font-semibold text-ink">IKRIS Doctor Connect</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
