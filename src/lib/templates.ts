import type { EmailTemplate } from "./types";

export const SAMPLE_DOCTOR = {
  name: "Dr. Asha Rao",
  specialization: "Medical Genetics",
  hospital: "Demo Hospital, New Delhi",
};

const TAG_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function mergeTags(text: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const m of (text ?? "").matchAll(TAG_RE)) found.add(m[1].trim());
  return Array.from(found);
}

function sampleFor(tag: string): string | null {
  const t = tag.toLowerCase().replace(/[\s_]/g, "");
  if (t === "doctorname" || t === "name") return SAMPLE_DOCTOR.name;
  if (t === "specialization" || t === "specialty" || t === "speciality") return SAMPLE_DOCTOR.specialization;
  if (t === "hospital" || t === "hospitalname" || t === "institute") return SAMPLE_DOCTOR.hospital;
  return null;
}

/** Fill merge tags with sample values; unknown tags are highlighted. */
export function fillSample(text: string, html: boolean): string {
  return text.replace(TAG_RE, (_m, tag: string) => {
    const v = sampleFor(tag);
    if (v) return v;
    return html ? `<mark style="background:#fde68a">{{${tag}}}</mark>` : `{{${tag}}}`;
  });
}

export function looksLikeHtml(body: string | null | undefined): boolean {
  return /<\s*(p|div|br|ul|li|table|strong|a)\b/i.test(body ?? "");
}

/** Body as the email client would show it, with sample values. */
export function previewDocument(body: string | null | undefined): string {
  const filled = fillSample(body ?? "", true);
  const content = looksLikeHtml(body) ? filled : `<div style="white-space:pre-wrap">${filled}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#333}
    img{max-width:100%}
  </style></head><body>${content}</body></html>`;
}

export interface Lint {
  level: "warning" | "info";
  text: string;
}

export function lintTemplate(t: Pick<EmailTemplate, "subject" | "body_html" | "kind">): Lint[] {
  const out: Lint[] = [];
  const all = `${t.subject ?? ""}\n${t.body_html ?? ""}`;
  if (/Dr\.?\s*\{\{\s*Doctor\s*_?Name\s*\}\}/i.test(all)) {
    out.push({
      level: "warning",
      text: "“Dr. {{Doctor Name}}”: most names in the doctor sheets already start with “Dr”, so emails may read “Dear Dr. Dr. …”.",
    });
  }
  if (t.kind !== "subject_line" && t.body_html && !looksLikeHtml(t.body_html) && t.body_html.length > 200) {
    out.push({
      level: "warning",
      text: "The body has no HTML line breaks. If the automation sends it as HTML, the whole email arrives as one paragraph.",
    });
  }
  if (t.kind !== "subject_line" && !t.subject?.trim() && t.body_html?.trim()) {
    out.push({ level: "info", text: "No subject in this template; the automation uses a subject line from the Subject Lines list." });
  }
  return out;
}

export function sheetLink(t: Pick<EmailTemplate, "spreadsheet_id" | "sheet_gid">): string {
  return `https://docs.google.com/spreadsheets/d/${t.spreadsheet_id}/edit${t.sheet_gid != null ? `#gid=${t.sheet_gid}` : ""}`;
}
