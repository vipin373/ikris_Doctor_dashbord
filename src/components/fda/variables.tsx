"use client";

import type { FdaConfig } from "@/lib/fda";

const FALLBACK = [
  "doctor_name", "hospital_name", "specialty", "department", "city", "drug_name", "brand_name", "active_ingredient", "indication",
  "therapeutic_area", "fda_status", "fda_approval_date", "manufacturer", "sender_name", "sender_phone", "sender_email",
].map((name) => ({ name, group: ["drug_name", "brand_name", "active_ingredient", "indication", "therapeutic_area", "fda_status", "fda_approval_date", "manufacturer"].includes(name) ? "FDA" : name.startsWith("sender") ? "Sender" : "Doctor", description: name }));

/** Clickable variables; inserts {{variable}} at the cursor of the target field. */
export function VariableChips({ config, targetId, value, onChange }: {
  config?: FdaConfig; targetId: string; value: string; onChange: (v: string) => void;
}) {
  const vars = config?.variables?.length ? config.variables : FALLBACK;
  const insert = (name: string) => {
    const tag = `{{${name}}}`;
    const el = document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
    if (!el || el.selectionStart === null) {
      onChange(value + tag);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + tag + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  };
  const groups = ["Doctor", "FDA", "Sender"];
  return (
    <div className="space-y-1.5 rounded-md bg-slate-50 px-3 py-2">
      {groups.map((g) => (
        <div key={g} className="flex flex-wrap items-center gap-1">
          <span className="w-14 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{g}</span>
          {vars.filter((v) => v.group === g).map((v) => (
            <button key={v.name} type="button" title={v.description} onClick={() => insert(v.name)}
              className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] text-brand-800 hover:border-brand-300 hover:bg-brand-50">
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
      ))}
      <p className="text-[10px] text-ink-soft">FDA variables are filled only from the FDA database; a missing value blocks the message instead of being guessed.</p>
    </div>
  );
}
