"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Activity, AlertTriangle, BarChart3, Bell, Briefcase, Cake, CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, Dna, FileSpreadsheet,
  FileText, HeartPulse, LayoutDashboard, LogOut, Loader2, Menu, MessageSquareHeart, Pill, RefreshCw, Search, Shield, Sparkles, Stethoscope,
  UserPlus, Users, X,
} from "lucide-react";
import { useAuth } from "./auth-provider";
import { api } from "@/lib/api";
import type { DoctorRow, Facets, Paged } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDateTime, number, slugify } from "@/lib/utils";
import { Badge, departmentTone } from "./ui/badge";
import { Button } from "./ui/button";
import { daysAgo, type RemindersData } from "./reminders-shared";

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
    { href: "/reminders", label: "Reminders", icon: Bell },
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
  if (me.departments.includes("NPP")) {
    items.push({ href: "/new-doctors", label: "New Doctors", icon: UserPlus });
  }
  items.push(
    { href: "/fda", label: "FDA", icon: Pill },
    { href: "/templates", label: "Email Templates", icon: FileText },
    { href: "/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/birthdays", label: "Birthdays", icon: Cake },
    { href: "/anniversaries", label: "Work Anniversaries", icon: Briefcase },
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

function initials(name: string): string {
  return name.split(/[\s@.]/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function Sidebar({ onNavigate, collapsed = false, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  const nav = useNav();
  const { me, signOut } = useAuth();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <nav className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-walnut-700 via-walnut-700 to-walnut-800 shadow-inset-walnut" aria-label="Main">
      {/* soft ambient lighting */}
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-glow-500/20 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-sage-400/15 blur-3xl" />

      <div className={cn("relative flex h-16 shrink-0 items-center border-b border-white/[0.08]", collapsed ? "justify-center px-2" : "gap-3 px-4")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-glow-300 via-glow-500 to-glow-700 text-[13px] font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_6px_16px_-6px_rgba(213,133,31,0.8)]">
          IK
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-white">IKRIS Doctor Connect</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-glow-200/80">Ikris Pharma Network</p>
          </div>
        )}
      </div>

      <div className={cn("relative flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-4", collapsed ? "px-2.5" : "px-3")}>
        {nav.map((item) => {
          const Icon = item.icon ?? Activity;
          const active = isActive(item.href);
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center rounded-xl text-[13px] font-medium outline-none transition-[background-color,color,box-shadow,transform] duration-250 ease-smooth",
                  "focus-visible:ring-2 focus-visible:ring-glow-400",
                  collapsed ? "h-10 justify-center" : "gap-3 px-3 py-2.5",
                  active
                    ? "bg-gradient-to-r from-sage-600 to-sage-600/85 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_14px_-8px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-sage-300/30"
                    : "text-walnut-100/85 hover:bg-white/[0.07] hover:text-white",
                )}
              >
                {active && (
                  <span aria-hidden className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-glow-400 shadow-[0_0_12px_2px_rgba(213,133,31,0.65)]" />
                )}
                <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-transform duration-250 ease-spring group-hover:scale-110",
                  active ? "text-white" : "text-walnut-200 group-hover:text-glow-200")} />
                {collapsed ? (
                  <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-walnut-950 px-2.5 py-1.5 text-xs font-medium text-walnut-50 opacity-0 shadow-pop transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100">
                    {item.label}
                  </span>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
              {!collapsed && item.children && item.children.length > 0 && (active || item.children.some((c) => isActive(c.href))) && (
                <div className="ml-[22px] mt-1 space-y-0.5 border-l border-white/10 pl-3 animate-fade-in">
                  {item.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      onClick={onNavigate}
                      className={cn(
                        "relative block rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-200",
                        isActive(c.href) ? "bg-white/[0.09] font-semibold text-white" : "text-walnut-200 hover:bg-white/[0.05] hover:text-white",
                      )}
                    >
                      {isActive(c.href) && <span aria-hidden className="absolute -left-[13px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-glow-400 shadow-[0_0_8px_rgba(213,133,31,0.8)]" />}
                      {c.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!collapsed && (
          <div className="pt-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-walnut-300">Coming in phase 2</p>
            {UPCOMING.map((label) => (
              <div key={label} className="flex items-center gap-3 px-3 py-1.5 text-[13px] text-walnut-300/80">
                <BarChart3 className="h-4 w-4 opacity-60" />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* profile */}
      {me && (
        <div className={cn("relative shrink-0 border-t border-white/[0.08] p-3", collapsed && "flex flex-col items-center gap-2")}>
          {onToggle && (
            <button onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn("flex items-center gap-2 rounded-lg p-1.5 text-[11px] font-medium text-walnut-200 transition-colors hover:bg-white/10 hover:text-white", !collapsed && "mb-2 w-full px-2.5")}>
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse menu</>}
            </button>
          )}
          <div className={cn("flex items-center rounded-xl", collapsed ? "justify-center" : "gap-3 bg-black/15 px-2.5 py-2 ring-1 ring-inset ring-white/[0.06]")}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sage-300 to-sage-600 text-[11px] font-bold text-white ring-2 ring-walnut-600" title={me.name || me.email}>
              {initials(me.name || me.email)}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-xs font-semibold text-white">{me.name || me.email}</span>
                  <span className="block truncate text-[10.5px] text-walnut-200">{DEPARTMENT_LABEL[me.role]}</span>
                </span>
                <button onClick={() => signOut()} aria-label="Sign out" title="Sign out"
                  className="rounded-lg p-1.5 text-walnut-200 transition-colors hover:bg-white/10 hover:text-white">
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

/** Bell with counts from the Reminders data (same data as the Reminders page). */
function NotificationCenter() {
  const { data } = useQuery({ queryKey: ["reminders"], queryFn: () => api.get<RemindersData>("/reminders"), staleTime: 5 * 60_000 });
  const f = data?.follow_ups ?? [];
  const overdue = f.filter((x) => x.bucket === "overdue").length;
  const soon = f.filter((x) => x.bucket === "today" || x.bucket === "week").length;
  const failed = f.filter((x) => x.failed?.length).length;
  const dates = data?.important_dates.length ?? 0;
  const mols = data ? data.new_molecules.filter((m) => (daysAgo(data.today, m.approval_date) ?? 999) <= 90).length : 0;
  const items = [
    { n: overdue, label: "Follow-up emails overdue", icon: AlertTriangle, tone: "text-red-600 bg-red-50", href: "/reminders" },
    { n: soon, label: "Follow-ups due in 7 days", icon: CalendarDays, tone: "text-glow-700 bg-glow-50", href: "/reminders" },
    { n: failed, label: "Doctors with a failed email", icon: AlertTriangle, tone: "text-red-600 bg-red-50", href: "/reminders" },
    { n: dates, label: "Birthdays & anniversaries this week", icon: Cake, tone: "text-walnut-700 bg-walnut-50", href: "/calendar" },
    { n: mols, label: "New FDA molecules (90 days)", icon: Sparkles, tone: "text-sage-700 bg-sage-50", href: "/fda?tab=drugs" },
  ].filter((i) => i.n > 0);
  const alerts = overdue + failed + dates + mols + soon;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger aria-label={`Notifications${alerts ? ` (${alerts})` : ""}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-white/90 text-ink-muted shadow-[0_1px_2px_rgba(41,37,31,0.05)] transition-[transform,box-shadow,color] duration-250 hover:-translate-y-px hover:text-ink hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-glow-400">
        <Bell className="h-4 w-4" />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-glow-500 px-1 text-[9.5px] font-bold text-white shadow-[0_0_0_2px_#F8F6F0,0_0_10px_rgba(213,133,31,0.6)]">
            {items.length}
          </span>
        )}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8}
          className="z-50 w-80 origin-top-right animate-pop-in rounded-2xl border border-line bg-white p-1.5 shadow-pop">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {data && <span className="text-[11px] text-ink-soft">From Reminders</span>}
          </div>
          <Dropdown.Separator className="mx-2 mb-1 h-px bg-line" />
          {!data ? (
            <p className="px-3 py-4 text-xs text-ink-soft">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-soft">You&apos;re all caught up.</p>
          ) : (
            items.map((i) => (
              <Dropdown.Item key={i.label} asChild>
                <Link href={i.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink outline-none transition-colors hover:bg-cream/60 focus:bg-cream/60">
                  <span className={cn("rounded-lg p-1.5", i.tone)}><i.icon className="h-3.5 w-3.5" /></span>
                  <span className="flex-1 text-[13px]">{i.label}</span>
                  <span className="text-sm font-bold tabular-nums">{number(i.n)}</span>
                </Link>
              </Dropdown.Item>
            ))
          )}
          <Dropdown.Separator className="mx-2 my-1 h-px bg-line" />
          <Dropdown.Item asChild>
            <Link href="/reminders" className="block rounded-xl px-3 py-2 text-xs font-semibold text-sage-700 outline-none hover:bg-sage-50 focus:bg-sage-50">
              Open Reminders →
            </Link>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

type LastSync = { status: string; started_at: string; finished_at: string | null } | null;
type SyncSummary = { status: string; new: number; updated: number; errors: number };

/** "Sync Google Sheets", available to every signed-in user. */
function SheetSyncButton() {
  const qc = useQueryClient();
  const last = useQuery({ queryKey: ["last-sync"], queryFn: () => api.get<LastSync>("/google-sheets/last-sync"), staleTime: 60_000 });
  const sync = useMutation({
    mutationFn: () => api.post<SyncSummary>("/google-sheets/sync"),
    onMutate: () => toast.info("Syncing Google Sheets… this can take up to a minute."),
    onSuccess: (r) => {
      qc.invalidateQueries();
      const msg = `${r.new} new, ${r.updated} updated`;
      if (r.status === "success") toast.success(`Google Sheets synced (${msg})`);
      else if (r.status === "partial") toast.warning(`Synced with some errors (${msg}, ${r.errors} errors)`);
      else toast.error("Sync failed. Ask an admin to check Google Sheets.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
  });
  const when = last.data?.finished_at || last.data?.started_at;
  return (
    <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}
      title={when ? `Last synced ${formatDateTime(when)}` : "Refresh data from Google Sheets"}>
      {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{sync.isPending ? "Syncing…" : "Sync Google Sheets"}</span>
    </Button>
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
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search doctors, hospitals, cities, email, phone, specialty…"
        className="h-10 w-full rounded-xl border border-line bg-white/80 pl-10 pr-3 text-sm shadow-[inset_0_1px_2px_rgba(41,37,31,0.04)] transition-[border-color,box-shadow,background-color] duration-250 placeholder:text-ink-soft focus:border-sage-400 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-sage-200/60"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 animate-pop-in overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
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
                      className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-sage-50"
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
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-cream/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-glow-400">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-walnut-500 to-walnut-800 text-[11px] font-bold text-white ring-2 ring-white shadow-card">{initials(me.name || me.email)}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-xs font-medium text-ink">{me.name || me.email}</span>
          <span className="block text-[10px] text-ink-soft">{DEPARTMENT_LABEL[me.role]}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-soft" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-50 w-60 origin-top-right animate-pop-in rounded-2xl border border-line bg-white p-1.5 shadow-pop">
          <div className="px-3 py-2">
            <p className="truncate text-xs font-medium text-ink">{me.email}</p>
            <Badge tone={me.role === "ADMIN" ? "brand" : departmentTone(me.role)} className="mt-1">
              {DEPARTMENT_LABEL[me.role]}
            </Badge>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item
            onSelect={() => signOut()}
            className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink outline-none transition-colors hover:bg-cream/60 focus:bg-cream/60"
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
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("ikris.sidebar") === "collapsed");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("ikris.sidebar", c ? "open" : "collapsed");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  }, []);

  React.useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || (!session && !accessError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-ink-soft">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-sage-200 border-t-glow-500" />
          Loading IKRIS Doctor Connect…
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="max-w-md rounded-card border border-line bg-white p-8 text-center shadow-lift">
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
    <div className="relative min-h-screen bg-canvas" style={{ ["--sidebar-w" as string]: collapsed ? "76px" : "256px" }}>
      <div className="ambient" aria-hidden />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-w)] transition-[width] duration-350 ease-smooth lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-fade-in bg-walnut-950/45 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[272px] max-w-[85vw] animate-[drawer-in_300ms_cubic-bezier(0.22,1,0.36,1)] shadow-pop">
            <button className="absolute right-3 top-4 z-10 rounded-lg p-1 text-walnut-100 hover:bg-white/10 hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="relative z-10 transition-[padding] duration-350 ease-smooth lg:pl-[var(--sidebar-w)]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line/70 bg-canvas/80 px-4 backdrop-blur-md lg:px-8">
          <button className="rounded-xl p-2 text-ink-muted transition-colors hover:bg-cream hover:text-ink lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <NotificationCenter />
            <SheetSyncButton />
            <UserMenu />
          </div>
        </header>
        <main key={pathname} className="mx-auto max-w-[1440px] animate-rise px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
