"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { DoctorDirectory } from "@/components/doctors/doctor-directory";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Department, Facets } from "@/lib/types";
import { cn, DEPARTMENT_LABEL, slugify } from "@/lib/utils";

const BASE: Record<Department, string> = { NPP: "/npp", RARE_DISEASES: "/rare-diseases" };

export function DepartmentView({ department, subSlug }: { department: Department; subSlug?: string }) {
  const { me } = useAuth();
  const { data: facets, isLoading } = useQuery({ queryKey: ["facets"], queryFn: () => api.get<Facets>("/doctors/facets") });
  const subs = (facets?.sub_departments ?? []).filter((s) => s.department === department);
  const total = subs.reduce((n, s) => n + s.count, 0);
  const current = subSlug ? subs.find((s) => slugify(s.value) === subSlug) : undefined;

  if (me && !me.departments.includes(department)) {
    return (
      <Card>
        <EmptyState title="No access" description={`Your role does not include ${DEPARTMENT_LABEL[department]}.`} />
      </Card>
    );
  }

  const title = current ? current.value : DEPARTMENT_LABEL[department] + (department === "NPP" ? " — Named Patient Programme" : "");
  return (
    <div>
      <PageHeader
        breadcrumb={current ? <Link href={BASE[department]} className="hover:underline">{DEPARTMENT_LABEL[department]}</Link> : undefined}
        title={title}
        description={
          department === "NPP"
            ? "Oncology and Hematology doctors under the Named Patient Programme."
            : "Rare Disease doctors across every specialty tab discovered in the sheets."
        }
      />
      <div className="mb-5 flex gap-3 overflow-x-auto pb-1">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <Link href={BASE[department]}
              className={cn("min-w-[150px] rounded-lg border bg-white px-4 py-3 shadow-card", !subSlug ? "border-brand-300 ring-2 ring-brand-100" : "border-line hover:border-brand-200")}>
              <p className="text-xs text-ink-soft">All</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{total.toLocaleString("en-IN")}</p>
            </Link>
            {subs.map((s) => (
              <Link key={s.value} href={`${BASE[department]}/${slugify(s.value)}`}
                className={cn("min-w-[150px] rounded-lg border bg-white px-4 py-3 shadow-card", subSlug === slugify(s.value) ? "border-brand-300 ring-2 ring-brand-100" : "border-line hover:border-brand-200")}>
                <p className="truncate text-xs text-ink-soft">{s.value}</p>
                <p className="text-lg font-semibold tabular-nums text-ink">{s.count.toLocaleString("en-IN")}</p>
              </Link>
            ))}
          </>
        )}
      </div>
      {subSlug && !isLoading && !current ? (
        <Card>
          <EmptyState title={`No ${subSlug.replace(/-/g, " ")} doctors found.`} description="Try changing your filters or search criteria." />
        </Card>
      ) : (
        <DoctorDirectory
          key={current?.value ?? "all"}
          fixed={{ department, ...(current ? { sub_department: current.value } : {}) }}
          emptyLabel={`${current?.value ?? DEPARTMENT_LABEL[department]} doctors`}
        />
      )}
    </div>
  );
}
