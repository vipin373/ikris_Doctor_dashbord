"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  AlertTriangle, ArrowDown, ArrowUp, Columns3, Download, Eye, Mail, MessageCircle, Phone, Search, SlidersHorizontal, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, departmentTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, Pagination, Skeleton, Td, Th, Tooltip } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { DoctorRow, Facets, Paged } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, formatDate, formatDayMonth, ISSUE_LABEL, whatsappLink } from "@/lib/utils";

type ColumnKey =
  | "s_no" | "doctor_name" | "qualification" | "specialty" | "category" | "department" | "institute" | "city"
  | "state" | "bdm" | "nsm" | "contact_number" | "whatsapp_number" | "email" | "date_of_birth" | "date_of_anniversary" | "last_contact_at";

const COLUMNS: { key: ColumnKey; label: string; sortable?: boolean; defaultVisible: boolean }[] = [
  { key: "s_no", label: "S.No.", defaultVisible: false },
  { key: "doctor_name", label: "Doctor Name", sortable: true, defaultVisible: true },
  { key: "qualification", label: "Qualification", defaultVisible: false },
  { key: "specialty", label: "Specialty", sortable: true, defaultVisible: true },
  { key: "category", label: "Category", sortable: true, defaultVisible: true },
  { key: "department", label: "Department", sortable: true, defaultVisible: true },
  { key: "institute", label: "Institute", sortable: true, defaultVisible: true },
  { key: "city", label: "City", sortable: true, defaultVisible: true },
  { key: "state", label: "State", sortable: true, defaultVisible: false },
  { key: "bdm", label: "BDM", sortable: true, defaultVisible: true },
  { key: "nsm", label: "NSM", sortable: true, defaultVisible: true },
  { key: "contact_number", label: "Contact", defaultVisible: false },
  { key: "whatsapp_number", label: "WhatsApp", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "date_of_birth", label: "Birthday", defaultVisible: false },
  { key: "date_of_anniversary", label: "Anniversary", defaultVisible: false },
  { key: "last_contact_at", label: "Last Contact", sortable: true, defaultVisible: true },
];

const FILTER_KEYS = [
  "department", "sub_department", "specialty", "category", "city", "bdm", "nsm", "has_email", "has_phone", "contact", "data_issue",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const FILTER_LABEL: Record<FilterKey, string> = {
  department: "Department", sub_department: "Sub-department", specialty: "Specialty", category: "Category", city: "City",
  bdm: "BDM", nsm: "NSM", has_email: "Email", has_phone: "Phone", contact: "Communication", data_issue: "Data quality",
};

function loadColumns(): Record<ColumnKey, boolean> {
  const defaults = Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultVisible])) as Record<ColumnKey, boolean>;
  try {
    const saved = window.localStorage.getItem("ikris:columns");
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

export function DoctorDirectory({
  fixed = {},
  emptyLabel = "doctors",
}: {
  fixed?: Partial<Record<FilterKey, string>>;
  emptyLabel?: string;
}) {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = React.useState(q);
  const [filters, setFilters] = React.useState<Partial<Record<FilterKey, string>>>(() => {
    const init: Partial<Record<FilterKey, string>> = {};
    FILTER_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) init[k] = v;
    });
    return init;
  });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [sort, setSort] = React.useState<{ key: string; order: "asc" | "desc" }>({ key: "doctor_name", order: "asc" });
  const [showFilters, setShowFilters] = React.useState(false);
  const [columns, setColumns] = React.useState<Record<ColumnKey, boolean>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultVisible])) as Record<ColumnKey, boolean>,
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => setColumns(loadColumns()), []);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => setQ(params.get("q") ?? ""), [params]);
  React.useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debouncedQ, filters, pageSize]);

  const query = { q: debouncedQ, ...filters, ...fixed };
  const { data: facets } = useQuery({ queryKey: ["facets"], queryFn: () => api.get<Facets>("/doctors/facets") });
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["doctors", query, page, pageSize, sort],
    queryFn: () => api.get<Paged<DoctorRow>>("/doctors", { ...query, page, page_size: pageSize, sort: sort.key, order: sort.order }),
    placeholderData: keepPreviousData,
  });

  const setFilter = (key: FilterKey, value: string) =>
    setFilters((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      if (key === "department") delete next.sub_department;
      return next;
    });

  const toggleColumn = (key: ColumnKey) =>
    setColumns((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        window.localStorage.setItem("ikris:columns", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, order: s.order === "asc" ? "desc" : "asc" } : { key, order: "asc" }));

  const exportCsv = async () => {
    try {
      await api.download("/doctors/export", query, "ikris-doctors.csv");
      toast.success("Export started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const exportSelected = () => {
    const rows = (data?.items ?? []).filter((d) => selected.has(d.id));
    const cols: ColumnKey[] = ["doctor_name", "specialty", "department", "institute", "city", "bdm", "nsm", "contact_number", "whatsapp_number", "email"];
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ikris-selected-doctors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const visible = COLUMNS.filter((c) => columns[c.key] && !(c.key === "department" && fixed.department));
  const departmentChoices = me?.departments ?? [];
  const subChoices = (facets?.sub_departments ?? []).filter(
    (s) => !(filters.department || fixed.department) || s.department === (filters.department || fixed.department),
  );
  const activeChips = Object.entries(filters) as [FilterKey, string][];
  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((d) => selected.has(d.id));

  return (
    <div className="rounded-lg border border-line bg-white shadow-card">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Try "Oncologist Delhi", "Apollo", "Category A", a phone or email'
            className="pl-9"
          />
        </div>
        <Button variant={showFilters ? "secondary" : "outline"} size="md" onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" /> Filters
          {activeChips.length > 0 && <Badge tone="brand">{activeChips.length}</Badge>}
        </Button>
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <Button variant="outline">
              <Columns3 className="h-4 w-4" /> Columns
            </Button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" sideOffset={6} className="z-50 max-h-80 w-52 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-lg">
              {COLUMNS.map((c) => (
                <Dropdown.CheckboxItem
                  key={c.key}
                  checked={columns[c.key]}
                  disabled={c.key === "doctor_name"}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleColumn(c.key)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-slate-100 data-[disabled]:opacity-50"
                >
                  <span className={cn("h-3.5 w-3.5 rounded border", columns[c.key] ? "border-brand-700 bg-brand-700" : "border-slate-300")} />
                  {c.label}
                </Dropdown.CheckboxItem>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* filter panel */}
      {showFilters && (
        <div className="grid grid-cols-2 gap-3 border-b border-line bg-slate-50/60 p-3 md:grid-cols-4 xl:grid-cols-6">
          {!fixed.department && departmentChoices.length > 1 && (
            <FilterSelect label="Department" value={filters.department} onChange={(v) => setFilter("department", v)}
              options={departmentChoices.map((d) => [d, DEPARTMENT_LABEL[d]])} />
          )}
          {!fixed.sub_department && (
            <FilterSelect label="Sub-department" value={filters.sub_department} onChange={(v) => setFilter("sub_department", v)}
              options={[...subChoices.map((s) => [s.value, `${s.value} (${s.count})`] as [string, string]), ["Unassigned", "Unassigned"]]} />
          )}
          <FilterSelect label="Specialty" value={filters.specialty} onChange={(v) => setFilter("specialty", v)}
            options={(facets?.specialties ?? []).map((s) => [s, s])} />
          <FilterSelect label="Category" value={filters.category} onChange={(v) => setFilter("category", v)}
            options={["A", "B", "C"].map((c) => [c, `Category ${c}`])} />
          <FilterSelect label="City" value={filters.city} onChange={(v) => setFilter("city", v)}
            options={(facets?.cities ?? []).map((c) => [c, c])} />
          <FilterSelect label="BDM" value={filters.bdm} onChange={(v) => setFilter("bdm", v)}
            options={(facets?.bdms ?? []).map((c) => [c, c])} emptyHint="Not in current sheets" />
          <FilterSelect label="NSM" value={filters.nsm} onChange={(v) => setFilter("nsm", v)}
            options={(facets?.nsms ?? []).map((c) => [c, c])} emptyHint="Not in current sheets" />
          <FilterSelect label="Email" value={filters.has_email} onChange={(v) => setFilter("has_email", v)}
            options={[["true", "Email available"], ["false", "No valid email"]]} />
          <FilterSelect label="Phone / WhatsApp" value={filters.has_phone} onChange={(v) => setFilter("has_phone", v)}
            options={[["true", "Phone available"], ["false", "No valid phone"]]} />
          <FilterSelect label="Communication" value={filters.contact} onChange={(v) => setFilter("contact", v)}
            options={[["contacted", "Email sent"], ["not_contacted", "Not contacted"], ...(facets?.contact_statuses ?? []).map((s) => [s, `Last status: ${s}`] as [string, string])]} />
          <FilterSelect label="Data quality" value={filters.data_issue} onChange={(v) => setFilter("data_issue", v)}
            options={[["any", "Any issue"], ...Object.entries(ISSUE_LABEL).slice(0, 5)]} />
        </div>
      )}

      {/* chips & bulk bar */}
      {(activeChips.length > 0 || selected.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {activeChips.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800">
              <span className="text-brand-500">{FILTER_LABEL[k]}:</span> {k === "department" ? DEPARTMENT_LABEL[v] : v}
              <button onClick={() => setFilter(k, "")} aria-label={`Remove ${FILTER_LABEL[k]} filter`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {activeChips.length > 0 && (
            <button className="text-xs font-medium text-ink-soft hover:text-ink" onClick={() => setFilters({})}>
              Clear filters
            </button>
          )}
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="font-medium text-ink">{selected.size} selected</span>
              <Button size="sm" variant="outline" onClick={exportSelected}>
                <Download className="h-3.5 w-3.5" /> Export selected
              </Button>
              <Tooltip label="Bulk email and WhatsApp arrive in phase 2">
                <Button size="sm" variant="outline" disabled>
                  <Mail className="h-3.5 w-3.5" /> Send email
                </Button>
              </Tooltip>
              <button className="text-ink-soft hover:text-ink" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {error ? (
        <div className="p-4">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : (
        <div className={cn("relative max-h-[calc(100vh-280px)] overflow-auto", isFetching && !isLoading && "opacity-70")}>
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <Th className="w-9">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((d) => d.id)))}
                  />
                </Th>
                {visible.map((c) => (
                  <Th key={c.key}>
                    {c.sortable ? (
                      <button className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => onSort(c.key)}>
                        {c.label}
                        {sort.key === c.key && (sort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </Th>
                ))}
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <Td colSpan={visible.length + 2}>
                      <Skeleton className="h-5 w-full" />
                    </Td>
                  </tr>
                ))}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 2}>
                    <EmptyState
                      icon={Search}
                      title={`No ${emptyLabel} found.`}
                      description="Try changing your filters or search criteria."
                      action={activeChips.length > 0 || q ? (
                        <Button variant="outline" size="sm" onClick={() => { setFilters({}); setQ(""); }}>Clear search and filters</Button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              )}
              {items.map((d) => (
                <tr key={d.id} className={cn("group hover:bg-brand-50/40", selected.has(d.id) && "bg-brand-50/60")}>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.doctor_name}`}
                      checked={selected.has(d.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(d.id)) n.delete(d.id);
                          else n.add(d.id);
                          return n;
                        })
                      }
                    />
                  </Td>
                  {visible.map((c) => (
                    <Td key={c.key} className={c.key === "doctor_name" ? "min-w-[200px]" : "whitespace-nowrap"}>
                      <Cell doctor={d} column={c.key} />
                    </Td>
                  ))}
                  <Td className="whitespace-nowrap text-right">
                    <RowActions doctor={d} onView={() => router.push(`/doctors/${d.id}`)} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 pl-4 text-xs text-ink-soft">
          Rows
          <select className="rounded border border-line px-1 py-0.5" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[25, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options, emptyHint,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  options: [string, string][];
  emptyHint?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-ink-soft">{label}</p>
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0 && !value} className="h-8 text-xs">
        <option value="">{options.length === 0 && emptyHint ? emptyHint : "All"}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </Select>
    </div>
  );
}

function Cell({ doctor: d, column }: { doctor: DoctorRow; column: ColumnKey }) {
  switch (column) {
    case "doctor_name":
      return (
        <div>
          <Link href={`/doctors/${d.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">
            {d.doctor_name}
          </Link>
          {d.data_issues?.length > 0 && (
            <Tooltip label={d.data_issues.map((i) => ISSUE_LABEL[i] ?? i).join(" · ")}>
              <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-amber-500" />
            </Tooltip>
          )}
          {d.sub_department && <p className="text-xs text-ink-soft">{d.sub_department}</p>}
        </div>
      );
    case "department":
      return <Badge tone={departmentTone(d.department)}>{DEPARTMENT_LABEL[d.department]}</Badge>;
    case "category":
      return d.category ? <Badge tone="brand">Cat {d.category}</Badge> : <span className="text-ink-soft">—</span>;
    case "email":
      return d.email ? <span className="text-ink-muted">{d.email}</span> : <span className="text-ink-soft">—</span>;
    case "date_of_birth":
    case "date_of_anniversary":
      return <>{formatDayMonth(d[column])}</>;
    case "last_contact_at":
      return d.last_contact_status ? (
        <div className="leading-tight">
          <Badge tone={statusTone(d.last_contact_status)}>{d.last_contact_status}</Badge>
          <p className="mt-0.5 text-[11px] text-ink-soft">{d.last_contact_at ? formatDate(d.last_contact_at) : "Date not recorded"}</p>
        </div>
      ) : (
        <span className="text-ink-soft">Not contacted</span>
      );
    default: {
      const v = d[column];
      return v ? <>{v}</> : <span className="text-ink-soft">—</span>;
    }
  }
}

function RowActions({ doctor: d, onView }: { doctor: DoctorRow; onView: () => void }) {
  const phone = d.whatsapp_number || d.contact_number;
  const wa = whatsappLink(phone);
  const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded text-ink-soft hover:bg-white hover:text-brand-800 disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="inline-flex items-center gap-0.5">
      <Tooltip label="View profile">
        <button className={iconBtn} onClick={onView} aria-label="View profile"><Eye className="h-4 w-4" /></button>
      </Tooltip>
      <Tooltip label={d.email ? "Email (opens your mail app)" : "No email"}>
        <a className={cn(iconBtn, !d.email && "pointer-events-none opacity-30")} href={d.email ? `mailto:${d.email}` : undefined} aria-label="Email">
          <Mail className="h-4 w-4" />
        </a>
      </Tooltip>
      <Tooltip label={wa ? "WhatsApp" : "No valid number"}>
        <a className={cn(iconBtn, !wa && "pointer-events-none opacity-30")} href={wa ?? undefined} target="_blank" rel="noreferrer" aria-label="WhatsApp">
          <MessageCircle className="h-4 w-4" />
        </a>
      </Tooltip>
      <Tooltip label={wa ? "Call" : "No valid number"}>
        <a className={cn(iconBtn, !wa && "pointer-events-none opacity-30")} href={wa ? `tel:${phone}` : undefined} aria-label="Call">
          <Phone className="h-4 w-4" />
        </a>
      </Tooltip>
    </div>
  );
}
