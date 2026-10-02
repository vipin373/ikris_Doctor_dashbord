export type Role = "ADMIN" | "NPP" | "RARE_DISEASES";
export type Department = "NPP" | "RARE_DISEASES";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  departments: Department[];
}

export interface DoctorRow {
  id: string;
  s_no: string | null;
  doctor_name: string;
  qualification: string | null;
  specialty: string | null;
  category: string | null;
  department: Department;
  sub_department: string | null;
  institute: string | null;
  city: string | null;
  state: string | null;
  bdm: string | null;
  nsm: string | null;
  contact_number: string | null;
  email: string | null;
  date_of_birth: string | null;
  date_of_anniversary: string | null;
  last_contact_at: string | null;
  last_contact_status: string | null;
  last_contact_channel: string | null;
  emails_sent: number;
  whatsapp_sent: number;
  data_issues: string[];
}

export interface Doctor extends DoctorRow {
  institute_address: string | null;
  country: string | null;
  whatsapp_number: string | null;
  email_norm: string | null;
  phone_norm: string | null;
  extra: Record<string, string>;
  source_spreadsheet_id: string | null;
  source_sheet_name: string | null;
  source_row_number: number | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  tab_id: number | null;
  spreadsheet_id: string;
  sheet_name: string;
  row_number: number;
  raw_data: Record<string, string | null>;
  missing_from_source: boolean;
  first_seen_at: string;
  last_synced_at: string;
  source_name?: string | null;
}

export interface CommEvent {
  id: number;
  channel: "EMAIL" | "WHATSAPP" | "CALL" | "NOTE";
  direction: "OUTBOUND" | "INBOUND";
  event_type: string;
  status: string;
  subject: string | null;
  detail: string | null;
  campaign: string | null;
  occurred_at: string | null;
  source: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Facets {
  departments: Department[];
  sub_departments: { department: Department; value: string; count: number }[];
  specialties: string[];
  cities: string[];
  categories: string[];
  bdms: string[];
  nsms: string[];
  contact_statuses: string[];
}

export interface DashboardSummary {
  role: Role;
  total_doctors: number;
  by_department: Partial<Record<Department, number>>;
  by_sub_department: { department: Department; name: string; count: number }[];
  by_category: { category: string; count: number }[];
  top_cities: { city: string; count: number }[];
  with_email: number;
  with_phone: number;
  data_issue_doctors: number;
  emails_sent: number;
  emails_failed: number;
  whatsapp_sent: number;
  replies: number;
  contacted_doctors: number;
  outreach_by_campaign: { campaign: string; status: string; count: number }[];
  feedback_total: number;
  feedback_by_status: Record<string, number>;
  upcoming_birthdays: number;
}

export interface FeedbackRow {
  id: string;
  department: Department;
  division: string | null;
  patient_name: string | null;
  country_code: string | null;
  phone_number: string | null;
  medicine: string | null;
  request_date: string | null;
  sent_date: string | null;
  whatsapp_status: string | null;
  status: string | null;
  rating: number | null;
  feedback: string | null;
  follow_up_required: boolean;
  review_link: string | null;
  data_issues: string[];
  source_row_number: number | null;
}

export interface SheetTab {
  id: number;
  source_id: number;
  tab_name: string;
  sheet_gid: number | null;
  data_kind: "doctors" | "feedback" | "ignore";
  department_code: Department | null;
  sub_department: string | null;
  specialty: string | null;
  mapping: Record<string, unknown>;
  is_enabled: boolean;
  headers: string[];
  record_count: number;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface SheetSource {
  id: number;
  name: string;
  spreadsheet_id: string;
  default_department: Department | null;
  description: string | null;
  is_active: boolean;
  tabs: SheetTab[];
}

export interface SyncResult {
  status: "success" | "partial" | "failed";
  new: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  flagged_missing: number;
  errors: number;
  new_events: number;
  tabs: { tab_id: number; source: string; tab: string; status: string; rows: number; errors: unknown[]; error?: string }[];
  steps: string[];
}

export interface SyncLog {
  id: number;
  trigger_type: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  duplicate_count: number;
  flagged_missing_count: number;
  error_count: number;
  details: Record<string, unknown>;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: Role | null;
  status: "active" | "disabled";
  created_at: string;
  last_login: string | null;
}

export interface AuditLog {
  id: number;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}
