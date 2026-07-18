// Domain types mirroring supabase/schema.sql. Postgres NUMERIC and DATE/TIME
// columns arrive over the wire as strings — they are typed as `string` here
// and parsed only at the display layer (see constraint #4 in the project spec).

// A "Sub" rank works in the higher capacity for LONG periods; "Acting" (24h or
// less) is never a rank — it stays as acting_note on payroll.
export type Rank =
  | 'AC' | 'Sub-AC' | 'DC' | 'Sub-DC' | 'Capt' | 'Sub-CAPT'
  | 'LT' | 'Sub-LT' | 'OP' | 'Sub-OP' | 'FF' | 'Sub-FF';

/** Canonical seniority order, most senior first. Use for any rank sorting. */
export const RANK_SENIORITY: readonly Rank[] = [
  'AC', 'Sub-AC', 'DC', 'Sub-DC', 'Capt', 'Sub-CAPT',
  'LT', 'Sub-LT', 'OP', 'Sub-OP', 'FF', 'Sub-FF',
];

export type Platoon = 'A' | 'B' | 'C';
export type EmployeeStatus = 'Active' | 'Inactive';

// 'Train' is duty (not leave): the employee stays listed but is excluded from
// staffing counts, and earns normal work credit on timesheet/payroll.
export type DutyStatus =
  | 'O' | 'Train' | 'AL' | 'SL' | 'EAL' | 'ISSL' | 'FODI' | 'ADM' | 'AWOL'
  | 'FL' | 'CT' | 'CL' | 'DET' | 'MWA' | 'OWD';

export type LeaveType =
  | 'AL' | 'EAL' | 'SL' | 'ISSL' | 'FODI' | 'ADM' | 'AWOL'
  | 'FL' | 'CT' | 'CL' | 'DET' | 'MWA';

export type LeaveStatus =
  | 'PendingApproval' | 'Granted' | 'Active' | 'Waitlist' | 'Promoted' | 'Cancelled' | 'Deleted';

export type AppRole = 'admin' | 'supervisor' | 'member';

export interface Employee {
  id: string;
  emp_number: number;
  last_name: string;
  first_name: string;
  middle_initial: string | null;
  rank: Rank;
  platoon: Platoon;
  company_code: string;
  station_override: string | null;
  dc_initial: string | null;
  supervisor: boolean;
  status: EmployeeStatus;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  code: string;
  station: string;
  district: number | null;
  suffix_rule: string | null;
  records_only: boolean;
  station_override: string | null;
  created_at: string;
  updated_at: string;
}

export interface RotationDay {
  id: string;
  shift_date: string;
  platoon: Platoon;
  pp_start: string;
  pp_end: string;
  created_at: string;
  shift_window_start?: string;
  shift_window_end?: string;
}

export interface DutyLedgerRow {
  id: string;
  shift_date: string;
  platoon: Platoon;
  employee_id: string;
  company_code: string;
  station: string;
  duty_status: DutyStatus;
  acting_note: string | null;
  shift_start: string;
  shift_end: string;
  hours_worked: string;
  is_closed: boolean;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveRecord {
  id: string;
  entry_id: string;
  employee_id: string;
  leave_type: LeaveType;
  shift_date: string;
  span_start: string;
  span_end: string;
  reason: string | null;
  status: LeaveStatus;
  parent_id: string | null;
  submitted_at: string;
  supervisor_id: string | null;
  capt_signed_at: string | null;
  dc_signed_at: string | null;
  sl_illness: boolean;
  sl_medical: boolean;
  sl_dental: boolean;
  sl_optical: boolean;
  sl_death: boolean;
  created_at: string;
  updated_at: string;
}

export interface DetRecord {
  id: string;
  employee_id: string;
  shift_date: string;
  detail_location: string;
  span_start: string;
  span_end: string;
  reason: string | null;
  status: 'PendingApproval' | 'Approved' | 'Denied' | 'Cancelled';
  created_at: string;
  updated_at: string;
}

export interface AlSlotLedger {
  id: string;
  platoon: Platoon;
  shift_date: string;
  peak_concurrent: number;
  max_slots: number;
  last_rebuilt_at: string;
}

export interface PayrollRow {
  id: string;
  shift_date: string;
  employee_id: string;
  company_code: string;
  station: string;
  platoon: Platoon;
  hours_worked: string;
  acting_note: string | null;
  acting_hours: string;
  leave_type: string | null;
  leave_hours_used: string;
  leave_span_start: string | null;
  leave_span_end: string | null;
  district: number | null;
  created_at: string;
  updated_at: string;
}

export interface TimesheetSegment {
  id: string;
  employee_id: string;
  pp_end: string;
  shift_date: string;
  segment_type: 'work' | 'leave';
  date_in: string | null;
  date_out: string | null;
  time_in: string | null;
  time_out: string | null;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_time_in: string | null;
  leave_time_out: string | null;
  hours: string;
  leave_type: string | null;
  created_at: string;
}

export interface ShiftClose {
  id: string;
  shift_date: string;
  station: string;
  platoon: Platoon;
  supervisor_id: string;
  signed_at: string;
  packet_sent_at: string | null;
  correction_count: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  occurred_at: string;
  actor_type: 'member' | 'supervisor' | 'admin' | 'system';
  actor_id: string | null;
  action: string;
  entry_id: string | null;
  detail: string | null;
}

export interface Notification {
  id: string;
  trigger_event: string;
  entry_id: string | null;
  recipient_ids: string[];
  subject: string;
  body_html: string;
  queued_at: string;
  sent_at: string | null;
  attempt_count: number;
  error_message: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  employee_id: string;
  role: AppRole;
  assigned_at: string;
  assigned_by: string | null;
}

export interface Setting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface OtAvailability {
  id: string;
  employee_id: string;
  available_from: string;
  available_through: string;
  target_platoon: Platoon | null;
  ot_type: string;
  excluded_dates: string[];
  created_at: string;
  updated_at: string;
}

export interface OtRequest {
  id: string;
  shift_date: string;
  company_code: string | null;
  rank_group: string;
  status: 'Open' | 'Offered' | 'Filled' | 'Cancelled' | 'Expired';
  filled_by: string | null;
  ladder_stage: 'T-24h' | 'T-12h' | 'T-1h' | 'T-15m' | 'Filled' | null;
  created_at: string;
  updated_at: string;
}

export interface OtTierBoardRow {
  employee_id: string;
  full_name: string;
  rank: Rank;
  platoon: Platoon;
  days_since_ot: number;
  last_ot_date: string | null;
}

// ---------------------------------------------------------------------------
// API envelope types
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  /** Optional explanatory note for an otherwise-empty success response (e.g. no rotation data for a period). */
  message?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthedUser {
  userId: string;
  email: string | null;
  employeeId: string | null;
  roles: AppRole[];
}
