"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Activity, BarChart3, CalendarDays, ChevronDown, Dna, FileSpreadsheet, FileText, HeartPulse, LayoutDashboard, LogOut,
  Menu, MessageSquareHeart, Search, Shield, Stethoscope, Users, X,
} from "lucide-react";
import { useAuth } from "./auth-provider";
import { api } from "@/lib/api";
import type { DoctorRow, Facets, Paged } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, slugify } from "@/lib/utils";
import { Badge, departmentTone } from "./ui/badge";
import { Button } from "./ui/button";

type NavItem = { href: string; label: string; icon?: React.ComponentType<{ className?: string }>; children?: NavItem[] };

function useNav(): NavItem[] {
  const { me } = useAuth();
  const { data: facets } = useQuery({ queryKey: ["facets"], queryFn: () => api.get<Facets>("/doctors/facets"), enabled: !!me });
  if (!me) return [];
  const subs = (dept: string) =>
    (facets?.sub_departments ?? [])
      .filter((s) => s.department === dept)
      .map((s) => ({ href: `/${dept === "NPP" ? "npp" : "rare-diseases"}/${slugify(s.value)}`, label: s.value }));

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/doctors", label: "Doctors", icon: Stethoscope },
  ];
  if (me.departments.includes("NPP")) {
    const npp = subs("NPP");
    items.push({
      href: "/npp", label: "NPP", icon: HeartPulse,
      children: npp.length ? npp : [{ href: "/npp/oncology", label: "Oncology" }, { href: "/npp/hematology", label: "Hematology" }],
    });
  }
  if (me.departments.includes("RARE_DISEASES")) {
    items.push({ href: "/rare-diseases", label: "Rare Diseases", icon: Dna, children: subs("RARE_DISEASES") });
  }
  items.push(
    { href: "/templates", label: "Email Templates", icon: FileText },
    { href: "/calendar", label: "Calendar & Birthdays", icon: CalendarDays },
    { href: "/feedback", label: "Patient Feedback", icon: MessageSquareHeart },
  );
  if (me.role === "ADMIN") {
    items.push(
      { href: "/google-sheets", label: "Google Sheets", icon: FileSpreadsheet },
      { href: "/users", label: "Users", icon: Users },
      { href: "/audit-logs", label: "Audit Logs", icon: Shield },
    );
  }
  return items;
}

const UPCOMING = ["Communications", "Campaigns", "Analytics"];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const nav = useNav();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-sm font-bold text-white">IK</div>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold text-white">IKRIS Doctor Connect</p>
          <p className="text-[10px] uppercase tracking-wider text-brand-200">Ikris Pharma Network</p>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {nav.map((item) => {
          const Icon = item.icon ?? Activity;
          const active = isActive(item.href);
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-white/10 text-white" : "text-brand-100 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 opacity-80" />
                {item.label}
              </Link>
              {item.children && item.children.length > 0 && (active || item.children.some((c) => isActive(c.href))) && (
                <div className="ml-9 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                  {item.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      onClick={onNavigate}
                      className={cn(
                        "block rounded px-2 py-1.5 text-xs",
                        isActive(c.href) ? "bg-white/10 text-white" : "text-brand-200 hover:text-white",
                      )}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="pt-5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-300">Coming in phase 2</p>
          {UPCOMING.map((label) => (
            <div key={label} className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-brand-300/70">
              <BarChart3 className="h-4 w-4 opacity-50" />
              {label}
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => api.get<Paged<DoctorRow>>("/doctors", { q: debounced, page_size: 8 }),
    enabled: debounced.length >= 2,
  });
  const groups = React.useMemo(() => {
    const g: Record<string, DoctorRow[]> = {};
    (data?.items ?? []).forEach((d) => {
      const key = DEPARTMENT_LABEL[d.department];
      (g[key] ||= []).push(d);
    });
    return g;
  }, [data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setOpen(false);
    router.push(`/doctors?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <form onSubmit={submit} className="relative w-full max-w-lg">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search doctors, hospitals, cities, email, phone, specialty…"
        className="h-9 w-full rounded-md border border-line bg-slate-50 pl-9 pr-3 text-sm placeholder:text-ink-soft focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
          {isFetching && !data ? (
            <p className="px-4 py-3 text-xs text-ink-soft">Searching…</p>
          ) : data && data.items.length === 0 ? (
            <p className="px-4 py-3 text-xs text-ink-soft">No doctors match “{debounced}”.</p>
          ) : (
            <>
              {Object.entries(groups).map(([group, rows]) => (
                <div key={group}>
                  <p className="bg-slate-50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">{group}</p>
                  {rows.map((d) => (
                    <button
                      type="button"
                      key={d.id}
                      onMouseDown={() => router.push(`/doctors/${d.id}`)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-brand-50"
                    >
                      <span>
                        <span className="block text-sm font-medium text-ink">{d.doctor_name}</span>
                        <span className="block text-xs text-ink-soft">
                          {[d.sub_department || d.specialty, d.institute, d.city].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              <button type="submit" className="w-full border-t border-line px-4 py-2 text-left text-xs font-medium text-brand-700 hover:bg-brand-50">
                See all {data?.total ?? ""} results →
              </button>
            </>
          )}
        </div>
      )}
    </form>
  );
}

function UserMenu() {
  const { me, signOut } = useAuth();
  if (!me) return null;
  const initials = (me.name || me.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100 focus:outline-none">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-800 text-[11px] font-semibold text-white">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-xs font-medium text-ink">{me.name || me.email}</span>
          <span className="block text-[10px] text-ink-soft">{DEPARTMENT_LABEL[me.role]}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-soft" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-50 w-56 rounded-lg border border-line bg-white p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-xs font-medium text-ink">{me.email}</p>
            <Badge tone={me.role === "ADMIN" ? "brand" : departmentTone(me.role)} className="mt-1">
              {DEPARTMENT_LABEL[me.role]}
            </Badge>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item
            onSelect={() => signOut()}
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-ink outline-none hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, session, loading, accessError, signOut } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || (!session && !accessError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-soft">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-800" />
          Loading IKRIS Doctor Connect…
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="max-w-md rounded-lg border border-line bg-white p-8 text-center shadow-card">
          <Shield className="mx-auto h-8 w-8 text-brand-700" />
          <h1 className="mt-3 text-base font-semibold text-ink">Access not available</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {accessError || "Your account does not have access yet."} Ask an administrator to assign your role (Admin, NPP or Rare Diseases).
          </p>
          <Button className="mt-5" variant="outline" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-brand-800 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-brand-800">
            <button className="absolute right-3 top-4 text-white" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-8">
          <button className="rounded p-1.5 text-ink-soft hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
