import type { Department } from "./types";

export type Area = "ONCOLOGY" | "HEMATOLOGY" | "RARE_DISEASE" | "OTHER";
export type Channel = "WHATSAPP" | "EMAIL" | "BOTH";
export type Method = "TEMPLATE" | "AI" | "MANUAL";

export const AREA_LABEL: Record<string, string> = {
  ONCOLOGY: "Oncology",
  HEMATOLOGY: "Hematology",
  RARE_DISEASE: "Rare Disease",
  OTHER: "Other",
  NEEDS_REVIEW: "Needs review",
  NPP: "NPP",
  GENERAL: "General",
};
export const AREA_TONE: Record<string, "sky" | "red" | "violet" | "neutral" | "amber" | "brand"> = {
  ONCOLOGY: "sky",
  HEMATOLOGY: "red",
  RARE_DISEASE: "violet",
  OTHER: "neutral",
  NEEDS_REVIEW: "amber",
  NPP: "brand",
  GENERAL: "neutral",
};
export const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", BOTH: "WhatsApp + Email" };
export const TEMPLATE_TYPES: Record<string, string> = {
  FDA_DRUG_UPDATE: "FDA Drug Update",
  NEW_DRUG: "New Drug",
  PRODUCT_INFORMATION: "Product Information",
  AVAILABILITY: "Availability",
  PATIENT_ACCESS: "Patient Access",
  DOCTOR_FOLLOW_UP: "Doctor Follow-up",
  GENERAL: "General",
  CUSTOM: "Custom",
};
export const FREQUENCY_LABEL: Record<string, string> = { WEEKLY: "Weekly", "15_DAYS": "15 Days", MONTHLY: "Monthly", CUSTOM: "Custom" };

export interface FdaDrug {
  id: string;
  application_number: string;
  application_type?: string | null;
  drug_name: string;
  brand_name: string | null;
  generic_name: string | null;
  active_ingredient: string | null;
  manufacturer: string | null;
  dosage_form?: string | null;
  strength?: string | null;
  route?: string | null;
  indication?: string | null;
  pharm_class?: string[];
  therapeutic_area: string | null;
  therapeutic_areas: string[];
  department: Area | null;
  classification_status: "CLASSIFIED" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED";
  fda_status: string | null;
  approval_date: string | null;
  latest_action_date?: string | null;
  marketing_status: string | null;
  fda_source: string;
  fda_source_url?: string | null;
  drugs_at_fda_url: string | null;
  label_url: string | null;
  label_effective_date?: string | null;
  source_last_updated?: string | null;
  last_synced_at: string | null;
  retrieved_at?: string | null;
  review_flags?: string[];
  last_sent_to_doctor?: string | null;
  matched_areas?: string[];
}

export interface Classification {
  id: number;
  department: string;
  therapeutic_areas: string[];
  confidence: number;
  reason: string;
  evidence: string[];
  source: "FDA_LABEL_RULES" | "OPENROUTER" | "MANUAL";
  model: string | null;
  review_status: string;
  classified_at: string;
}

export interface SyncRun {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  mode: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  failed_count: number;
  fetched_count: number;
  errors: string[];
  source_last_updated: string | null;
}

export interface FdaOverview {
  total: number;
  by_department: Record<string, number>;
  needs_review: number;
  last_sync: SyncRun | null;
  last_success: string | null;
}

export interface FdaConfig {
  fda_api: string;
  fda_api_key: boolean;
  openrouter: boolean;
  openrouter_model: string | null;
  cunnekt: boolean;
  email: boolean;
  email_missing: string[];
  kegg: boolean;
  variables: { name: string; group: string; description: string }[];
}

export interface FdaDoctor {
  id: string;
  doctor_name: string;
  specialty: string | null;
  department: Department;
  sub_department: string | null;
  institute: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  contact_number: string | null;
  whatsapp_number: string | null;
  must_see: boolean;
  contact_frequency: string | null;
  frequency_days: number | null;
  last_message_sent_at: string | null;
  next_eligible_at: string | null;
  created_at: string;
  origin: string;
  areas: string[];
  areas_label: string;
  eligible: boolean;
  eligible_from: string | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  department: string;
  channel: Channel;
  template_type: string;
  language: string;
  subject: string | null;
  body: string;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  version: number;
  whatsapp_template_name: string | null;
  whatsapp_template_id: string | null;
  whatsapp_approval_status: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
  whatsapp_variables: string[];
  updated_at: string;
}

export interface Issue {
  level: "block" | "warn";
  text: string;
}

export interface GeneratedMessage {
  id: string;
  campaign_doctor_id: number;
  doctor_id: string;
  drug_id: string | null;
  channel: "WHATSAPP" | "EMAIL";
  method: Method;
  template_id: string | null;
  template_version: number | null;
  subject: string | null;
  body: string;
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "SENT" | "FAILED";
  issues: Issue[];
  approved_at: string | null;
  delivery?: {
    id: number;
    status: string;
    error: string | null;
    provider_message_id: string | null;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    failed_at: string | null;
  } | null;
}

export interface CampaignDoctor {
  id: number;
  doctor_id: string;
  department: Department;
  drug_id: string | null;
  match_reason: string | null;
  status: "PENDING" | "GENERATED" | "SKIPPED";
  skip_reason: string | null;
  doctor: { doctor_name: string; specialty: string | null; sub_department: string | null; institute: string | null; must_see: boolean } | null;
  drug: { drug_name: string; fda_status: string | null; therapeutic_area: string | null } | null;
}

export interface Campaign {
  id: string;
  name: string;
  mode: "SINGLE" | "BULK";
  channel: Channel;
  message_method: Method;
  drug_mode: "AUTO" | "MANUAL";
  status: string;
  created_at: string;
  objective: string | null;
}

export interface CampaignDetail {
  campaign: Campaign;
  doctors: CampaignDoctor[];
  messages: GeneratedMessage[];
  counts: Record<string, number>;
  pending: number;
}

export const MESSAGE_STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "brand" | "sky" | "violet"> = {
  DRAFT: "neutral",
  NEEDS_REVIEW: "amber",
  APPROVED: "brand",
  REJECTED: "neutral",
  SENT: "green",
  FAILED: "red",
  QUEUED: "neutral",
  DELIVERED: "green",
  READ: "green",
  BLOCKED: "amber",
  NOT_SENT: "amber",
};

export function fdaDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
