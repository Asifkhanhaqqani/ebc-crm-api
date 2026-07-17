// Pure shift, segment, and pay-period math shared by timesheetService,
// payrollService, and workforce reporting. This module must stay free of
// config/db imports so the business rules are unit-testable without a live
// Supabase connection (config.ts throws on import when env is absent).

import { DutyStatus } from '../types';

export const SHIFT_START = '07:00';
export const SHIFT_LENGTH_MIN = 24 * 60;

// Confirmed pay-period anchor: Saturday 2026-05-30 07:00. Periods are 14 days,
// running [pp_start 07:00, pp_start+14d 07:00). A pay period is retroactive:
// the Saturday the client calls the period's "end date" is pp_start+14, and
// the period covers only the 14 days BEFORE that boundary, never after.
export const PP_ANCHOR = '2026-05-30';

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(mins: number): string {
  const normalized = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay
  );
}

export function hoursBetween(startMin: number, endMin: number): number {
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Staffing
// ---------------------------------------------------------------------------

/**
 * Whether a duty_ledger row counts toward the on-duty / minimum-staffing
 * numbers. Only 'O' counts: Train keeps the employee listed on the workforce
 * sheet but treats them as absent from the station (a station may go short
 * because of Train), and every leave/detail status is likewise absent.
 */
export function isCountedForStaffing(status: DutyStatus): boolean {
  return status === 'O';
}

/**
 * Whether a duty status earns normal work credit on timesheet and payroll.
 * Train is NOT leave: a Train day pays identically to a plain O day (full
 * hours). It must never appear as a leave type or reduce pay.
 */
export function earnsNormalWorkCredit(status: DutyStatus): boolean {
  return status === 'O' || status === 'Train';
}

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------

/** The pp_start date (a Saturday) of the pay period containing shiftDate. */
export function payPeriodStartFor(shiftDate: string): string {
  const offset = Math.floor(daysBetween(PP_ANCHOR, shiftDate) / 14) * 14;
  return addDaysIso(PP_ANCHOR, offset);
}

/**
 * The Saturday the client calls the pay period's "end date": the 07:00
 * boundary at pp_start+14. The period covers shift dates pp_start .. pp_start+13;
 * the last shift (pp_start+13) ends exactly at this boundary. A shift dated on
 * the boundary Saturday itself belongs entirely to the NEXT period.
 */
export function payPeriodEndBoundaryFor(shiftDate: string): string {
  return addDaysIso(payPeriodStartFor(shiftDate), 14);
}

/** The rotation_schedule.pp_end key (last shift DATE in the period) = pp_start+13. */
export function payPeriodEndKeyFor(shiftDate: string): string {
  return addDaysIso(payPeriodStartFor(shiftDate), 13);
}

// ---------------------------------------------------------------------------
// Shift-window span math
// ---------------------------------------------------------------------------

export interface LeaveSpan {
  span_start: string;
  span_end: string;
  leave_type: string;
}

/**
 * Anchors a leave span to the shift's 07:00 start and clamps it to the 24-hour
 * shift window [07:00, 07:00+24h). Hours outside the window belong to the
 * adjacent shift date (and therefore potentially to the adjacent pay period) —
 * they must be recorded on that date's own records, never bled across the
 * boundary. Returns null when the span falls entirely outside the window.
 */
export function normalizeSpanToShiftWindow(
  span: Pick<LeaveSpan, 'span_start' | 'span_end'>
): { startMin: number; endMin: number } | null {
  const windowStart = toMinutes(SHIFT_START);
  const windowEnd = windowStart + SHIFT_LENGTH_MIN;

  let start = toMinutes(span.span_start);
  let end = toMinutes(span.span_end);
  if (end <= start) end += 1440;
  if (start < windowStart) {
    start += 1440;
    if (end < start) end += 1440;
  }

  const clampedStart = Math.max(start, windowStart);
  const clampedEnd = Math.min(end, windowEnd);
  if (clampedEnd <= clampedStart) return null;
  return { startMin: clampedStart, endMin: clampedEnd };
}

/** Leave hours falling inside the shift window (payroll leave_hours_used). */
export function clampedSpanHours(span: Pick<LeaveSpan, 'span_start' | 'span_end'>): number {
  const normalized = normalizeSpanToShiftWindow(span);
  return normalized ? hoursBetween(normalized.startMin, normalized.endMin) : 0;
}

// ---------------------------------------------------------------------------
// Timesheet segments
// ---------------------------------------------------------------------------

export interface DaySegment {
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
  hours: number;
  leave_type: string | null;
}

/**
 * Builds the work/leave segments for one 24-hour shift. Segments are clamped
 * to the shift window, so no segment can ever cross a pay-period boundary
 * (period boundaries always coincide with a Saturday 07:00 shift boundary).
 *
 * duty_status never enters this math: a Train day produces segments identical
 * to a plain O day — see earnsNormalWorkCredit().
 */
export function computeDaySegments(
  employeeId: string,
  ppEnd: string,
  shiftDate: string,
  leaves: LeaveSpan[]
): DaySegment[] {
  const segments: DaySegment[] = [];
  const windowStart = toMinutes(SHIFT_START);
  const windowEnd = windowStart + SHIFT_LENGTH_MIN;

  const normalized = leaves
    .map((leave) => ({ leave, span: normalizeSpanToShiftWindow(leave) }))
    .filter((n): n is { leave: LeaveSpan; span: { startMin: number; endMin: number } } =>
      n.span !== null
    )
    .sort((a, b) => a.span.startMin - b.span.startMin);

  let pointer = windowStart;
  for (const { leave, span } of normalized) {
    if (pointer < span.startMin) {
      segments.push(buildWorkSegment(employeeId, ppEnd, shiftDate, pointer, span.startMin));
    }
    const start = Math.max(pointer, span.startMin);
    if (start < span.endMin) {
      segments.push(
        buildLeaveSegment(employeeId, ppEnd, shiftDate, start, span.endMin, leave.leave_type)
      );
    }
    pointer = Math.max(pointer, span.endMin);
  }

  if (pointer < windowEnd) {
    segments.push(buildWorkSegment(employeeId, ppEnd, shiftDate, pointer, windowEnd));
  }

  return segments;
}

function buildWorkSegment(
  employeeId: string,
  ppEnd: string,
  shiftDate: string,
  startMin: number,
  endMin: number
): DaySegment {
  const dateOut = endMin >= 24 * 60 ? addDaysIso(shiftDate, 1) : shiftDate;
  return {
    employee_id: employeeId,
    pp_end: ppEnd,
    shift_date: shiftDate,
    segment_type: 'work',
    date_in: shiftDate,
    date_out: dateOut,
    time_in: minutesToHHMM(startMin),
    time_out: minutesToHHMM(endMin),
    leave_start_date: null,
    leave_end_date: null,
    leave_time_in: null,
    leave_time_out: null,
    hours: hoursBetween(startMin, endMin),
    leave_type: null,
  };
}

function buildLeaveSegment(
  employeeId: string,
  ppEnd: string,
  shiftDate: string,
  startMin: number,
  endMin: number,
  leaveType: string
): DaySegment {
  const leaveEndDate = endMin >= 24 * 60 ? addDaysIso(shiftDate, 1) : shiftDate;
  return {
    employee_id: employeeId,
    pp_end: ppEnd,
    shift_date: shiftDate,
    segment_type: 'leave',
    date_in: null,
    date_out: null,
    time_in: null,
    time_out: null,
    leave_start_date: shiftDate,
    leave_end_date: leaveEndDate,
    leave_time_in: minutesToHHMM(startMin),
    leave_time_out: minutesToHHMM(endMin),
    hours: hoursBetween(startMin, endMin),
    leave_type: leaveType,
  };
}
