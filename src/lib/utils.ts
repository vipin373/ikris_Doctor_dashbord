import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const IST = "Asia/Kolkata";

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: IST });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: IST,
  });
}

export function formatDayMonth(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: IST });
}

export function number(n?: number | null): string {
  return (n ?? 0).toLocaleString("en-IN");
}

export const DEPARTMENT_LABEL: Record<string, string> = {
  NPP: "NPP",
  RARE_DISEASES: "Rare Diseases",
  ADMIN: "Admin",
};

export const ISSUE_LABEL: Record<string, string> = {
  email_invalid: "Invalid email in sheet",
  email_multiple: "Several emails in one cell (first one used)",
  phone_lost_in_sheet: "Phone number lost in sheet (shown as 9.9E+09)",
  phone_invalid: "Invalid phone number",
  whatsapp_invalid: "Invalid WhatsApp number",
  possible_duplicate: "Possible duplicate (same name, different contact)",
  looks_like_test_record: "Looks like a test record",
  date_of_birth_invalid: "Date of birth could not be read",
  date_of_anniversary_invalid: "Anniversary date could not be read",
  request_date_invalid: "Request date could not be read",
  sent_date_invalid: "Sent date could not be read",
  rating_invalid: "Rating could not be read",
};

export function slugify(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function digits(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

export function whatsappLink(phone?: string | null): string | null {
  const d = digits(phone);
  if (d.length === 10) return `https://wa.me/91${d}`;
  if (d.length >= 11 && d.length <= 15) return `https://wa.me/${d}`;
  return null;
}
