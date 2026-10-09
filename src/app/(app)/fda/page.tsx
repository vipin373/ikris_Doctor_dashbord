"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, History, Pill, Send, Settings2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { DrugIntelligence } from "@/components/fda/drugs";
import { SingleMessage } from "@/components/fda/single";
import { BulkUpload } from "@/components/fda/bulk";
import { FdaTemplates } from "@/components/fda/templates";
import { SentMessages } from "@/components/fda/messages";
import { FdaSettingsDialog } from "@/components/fda/settings";
import { api } from "@/lib/api";
import type { FdaConfig } from "@/lib/fda";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "drugs", label: "Drug Intelligence", icon: Pill },
  { id: "single", label: "Single Message", icon: Send },
  { id: "bulk", label: "Bulk Upload", icon: Upload },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "messages", label: "Sent Messages", icon: History },
] as const;
type Tab = (typeof TABS)[number]["id"];

function FdaPageInner() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "drugs") as Tab;
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const config = useQuery({ queryKey: ["fda-config"], queryFn: () => api.get<FdaConfig>("/fda/config"), staleTime: 300_000 });
  const setTab = (t: Tab) => router.replace(`/fda?tab=${t}`, { scroll: false });

  const missing = config.data
    ? [
        !config.data.cunnekt && "WhatsApp (CUNNEKT_API_KEY)",
        !config.data.email && `Email (${config.data.email_missing.join(", ")})`,
        !config.data.openrouter && "AI drafting (OPENROUTER_API_KEY)",
      ].filter(Boolean)
    : [];

  return (
    <div>
      <PageHeader
        title="FDA"
        description="FDA drug intelligence and doctor communication. Drug facts come from openFDA; every message is previewed and approved before it is sent."
        actions={me?.role === "ADMIN" && (
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /> FDA settings</Button>
        )}
      />

      {missing.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Not configured on the server yet: {missing.join(" · ")}. Those channels will show a clear error instead of sending.</span>
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === t.id ? "border-brand-800 text-brand-800" : "border-transparent text-ink-soft hover:text-ink")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "drugs" && <DrugIntelligence />}
      {tab === "single" && <SingleMessage config={config.data} />}
      {tab === "bulk" && <BulkUpload config={config.data} />}
      {tab === "templates" && <FdaTemplates config={config.data} />}
      {tab === "messages" && <SentMessages />}

      {settingsOpen && <FdaSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default function FdaPage() {
  return (
    <React.Suspense fallback={null}>
      <FdaPageInner />
    </React.Suspense>
  );
}
