import { supabaseAdmin } from '../config';
import { assertNoDbError } from '../utils/db';
import { PayrollRow } from '../types';

const FULL_SHIFT_HOURS = 24;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Handles a span that crosses the 07:00 shift boundary (end <= start means overnight). */
function spanHours(startStr: string, endStr: string): number {
  const start = toMinutes(startStr);
  let end = toMinutes(endStr);
  if (end <= start) {
    // e.g. span_start=19:00, span_end=07:00 → (24 - hours(start)) + hours(end)
    end += 24 * 60;
  }
  return Math.round(((end - start) / 60) * 100) / 100;
}

/** Parses acting notes like 'ACT-Capt 1900→0700' into { role, start, end } or null. */
function parseActingNote(note: string | null): { start: string; end: string } | null {
  if (!note) return null;
  const match = note.match(/(\d{4})\s*(?:→|->|-)\s*(\d{4})/);
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  const start = `${startRaw.slice(0, 2)}:${startRaw.slice(2)}`;
  const end = `${endRaw.slice(0, 2)}:${endRaw.slice(2)}`;
  return { start, end };
}

interface NewPayrollRow {
  shift_date: string;
  employee_id: string;
  company_code: string;
  station: string;
  platoon: string;
  hours_worked: number;
  acting_note: string | null;
  acting_hours: number;
  leave_type: string | null;
  leave_hours_used: number;
  leave_span_start: string | null;
  leave_span_end: string | null;
  district: number | null;
}

export const payrollService = {
  async buildPayrollForDate(shiftDate: string): Promise<PayrollRow[]> {
    const { data: dutyRows, error: dutyError } = await supabaseAdmin
      .from('duty_ledger')
      .select('*, companies!inner(district)')
      .eq('shift_date', shiftDate);
    assertNoDbError(dutyError, 'buildPayrollForDate duty lookup');

    const rowsToInsert: NewPayrollRow[] = [];

    for (const duty of dutyRows ?? []) {
      const district = (duty as any).companies?.district ?? null;

      const { data: leaves, error: leaveError } = await supabaseAdmin
        .from('leave_records')
        .select('leave_type, span_start, span_end')
        .eq('shift_date', shiftDate)
        .eq('employee_id', duty.employee_id)
        .in('status', ['Granted', 'Active']);
      assertNoDbError(leaveError, 'buildPayrollForDate leave lookup');

      const totalLeaveHours = (leaves ?? []).reduce(
        (sum, l) => sum + spanHours(l.span_start, l.span_end),
        0
      );

      const actingSpan = parseActingNote(duty.acting_note);
      const actingHours = actingSpan ? spanHours(actingSpan.start, actingSpan.end) : 0;

      const hoursWorked = Math.round((FULL_SHIFT_HOURS - totalLeaveHours) * 100) / 100;

      rowsToInsert.push({
        shift_date: shiftDate,
        employee_id: duty.employee_id,
        company_code: duty.company_code,
        station: duty.station,
        platoon: duty.platoon,
        hours_worked: hoursWorked,
        acting_note: duty.acting_note,
        acting_hours: actingHours,
        leave_type: null,
        leave_hours_used: 0,
        leave_span_start: null,
        leave_span_end: null,
        district,
      });

      for (const leave of leaves ?? []) {
        rowsToInsert.push({
          shift_date: shiftDate,
          employee_id: duty.employee_id,
          company_code: duty.company_code,
          station: duty.station,
          platoon: duty.platoon,
          hours_worked: hoursWorked,
          acting_note: duty.acting_note,
          acting_hours: actingHours,
          leave_type: leave.leave_type,
          leave_hours_used: spanHours(leave.span_start, leave.span_end),
          leave_span_start: leave.span_start,
          leave_span_end: leave.span_end,
          district,
        });
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from('payroll_rows')
      .delete()
      .eq('shift_date', shiftDate);
    assertNoDbError(deleteError, 'buildPayrollForDate clear existing');

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('payroll_rows').insert(rowsToInsert);
      assertNoDbError(insertError, 'buildPayrollForDate insert');
    }

    const { data: inserted, error: refetchError } = await supabaseAdmin
      .from('payroll_rows')
      .select('*')
      .eq('shift_date', shiftDate);
    assertNoDbError(refetchError, 'buildPayrollForDate refetch');

    return (inserted ?? []) as PayrollRow[];
  },
};
