"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, EmptyState, ErrorState, PageHeader, Skeleton, Td, Th } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { Role, UserProfile } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin — everything", NPP: "NPP — Oncology & Hematology", RARE_DISEASES: "Rare Diseases — all specialties" };

export default function UsersPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ items: UserProfile[]; can_invite: boolean }>("/users"),
    enabled: me?.role === "ADMIN",
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UserProfile> }) => api.put(`/users/${id}`, body),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  if (me && me.role !== "ADMIN") return <Card><EmptyState title="Administrator access required" /></Card>;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader
        title="Users"
        description="Three roles: Admin sees everything, NPP sees only NPP, Rare Diseases sees only Rare Diseases. Enforced in the API and in the database."
        actions={<Button onClick={() => setInviteOpen(true)} disabled={!data?.can_invite}><UserPlus className="h-4 w-4" /> Invite user</Button>}
      />
      {data && !data.can_invite && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Inviting needs <b>SUPABASE_SERVICE_ROLE_KEY</b> on the server. Until then, add users in Supabase → Authentication → Users; they appear here and you can assign their role.
        </p>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Last login</Th><Th>Created</Th></tr></thead>
            <tbody>
              {isLoading && Array.from({ length: 3 }).map((_, i) => <tr key={i}><Td colSpan={6}><Skeleton className="h-5" /></Td></tr>)}
              {data?.items.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.name || "—"}{u.id === me?.id && <Badge tone="brand" className="ml-2">You</Badge>}</Td>
                  <Td className="text-ink-muted">{u.email}</Td>
                  <Td>
                    <Select className="h-8 w-60 text-xs" value={u.role ?? ""} disabled={u.id === me?.id || update.isPending}
                      onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}>
                      {!u.role && <option value="">No access (assign a role)</option>}
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    <button disabled={u.id === me?.id} onClick={() => update.mutate({ id: u.id, body: { status: u.status === "active" ? "disabled" : "active" } })}>
                      <Badge tone={statusTone(u.status)}>{u.status === "active" ? "Active" : "Disabled"}</Badge>
                    </button>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(u.last_login)}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(u.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ email: "", name: "", role: "NPP" as Role });
  const m = useMutation({
    mutationFn: () => api.post("/users", form),
    onSuccess: () => {
      toast.success(`Invitation sent to ${form.email}`);
      qc.invalidateQueries({ queryKey: ["users"] });
      setForm({ email: "", name: "", role: "NPP" });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Invite failed"),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite user" description="They receive an email to set their password."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} disabled={m.isPending || !form.email}>Send invitation</Button></>}>
      <div className="space-y-3">
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div>
          <Label>Role</Label>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </div>
      </div>
    </Dialog>
  );
}
