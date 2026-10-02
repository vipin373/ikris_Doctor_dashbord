"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { AuditLog, Paged } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const ACTIONS = ["Login", "Logout", "Google Sheet synced", "Doctors exported", "User created", "Permission changed", "User updated", "Settings changed"];

export default function AuditLogsPage() {
  const { me } = useAuth();
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState("");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit", page, action],
    queryFn: () => api.get<Paged<AuditLog>>("/audit-logs", { page, action, page_size: 50 }),
    placeholderData: keepPreviousData,
    enabled: me?.role === "ADMIN",
  });
  if (me && me.role !== "ADMIN") return <Card><EmptyState title="Administrator access required" /></Card>;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <div>
      <PageHeader title="Audit Logs" description="Who did what, and when."
        actions={
          <Select className="w-56" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </Select>
        } />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead><tr><Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th><Th>IP</Th></tr></thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => <tr key={i}><Td colSpan={6}><Skeleton className="h-5" /></Td></tr>)}
              {data?.items.length === 0 && <tr><td colSpan={6}><EmptyState title="No audit events yet" /></td></tr>}
              {data?.items.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(l.created_at)}</Td>
                  <Td className="text-xs">{l.user_email || "System (scheduled)"}</Td>
                  <Td className="font-medium">{l.action}</Td>
                  <Td className="text-xs text-ink-muted">{[l.entity, l.entity_id].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td className="max-w-md truncate font-mono text-[11px] text-ink-muted" title={JSON.stringify(l.details)}>
                    {Object.keys(l.details || {}).length ? JSON.stringify(l.details) : "—"}
                  </Td>
                  <Td className="text-xs text-ink-soft">{l.ip || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={50} total={data?.total ?? 0} onPage={setPage} />
      </Card>
    </div>
  );
}
