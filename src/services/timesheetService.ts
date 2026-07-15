import { supabaseAdmin } from '../config';
import { assertNoDbError } from '../utils/db';
import { rotationService } from './rotationService';
import { TimesheetSegment } from '../types';

const SHIFT_START = '07:00';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(mins: number): string {
  const normalized = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hoursBetween(startMin: number, endMin: number): number {
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

interface NewSegment {
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

export const timesheetService = {
  async buildTimesheet(employeeId: string, ppEnd: string): Promise<TimesheetSegment[]> {
    const periodDays = await rotationService.getPeriodDays(ppEnd);
    const segments: NewSegment[] = [];

    for (const day of periodDays) {
      const shiftDate = day.shift_date;

      const { data: dutyRow, error: dutyError } = await supabaseAdmin
        .from('duty_ledger')
        .select('id')
        .eq('shift_date', shiftDate)
        .eq('employee_id', employeeId)
        .maybeSingle();
      assertNoDbError(dutyError, 'buildTimesheet duty lookup');
      if (!dutyRow) continue;

      const { data: leaves, error: leaveError } = await supabaseAdmin
        .from('leave_records')
        .select('span_start, span_end, leave_type')
        .eq('shift_date', shiftDate)
        .eq('employee_id', employeeId)
        .in('status', ['Granted', 'Active'])
        .order('span_start', { ascending: true });
      assertNoDbError(leaveError, 'buildTimesheet leave lookup');

      let pointer = toMinutes(SHIFT_START); // minutes since shift_date 07:00
      const shiftEnd = pointer + 24 * 60;

      for (const leave of leaves ?? []) {
        let spanStart = toMinutes(leave.span_start);
        let spanEnd = toMinutes(leave.span_end);
        if (spanEnd <= spanStart) spanEnd += 24 * 60;
        // Anchor spans relative to the shift's 07:00 start.
        if (spanStart < toMinutes(SHIFT_START)) spanStart += 24 * 60;
        if (spanEnd < spanStart) spanEnd += 24 * 60;

        if (pointer < spanStart) {
          segments.push(
            buildWorkSegment(employeeId, ppEnd, shiftDate, pointer, spanStart)
          );
        }

        segments.push(
          buildLeaveSegment(employeeId, ppEnd, shiftDate, spanStart, spanEnd, leave.leave_type)
        );

        pointer = Math.max(pointer, spanEnd);
      }

      if (pointer < shiftEnd) {
        segments.push(buildWorkSegment(employeeId, ppEnd, shiftDate, pointer, shiftEnd));
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from('timesheet_segments')
      .delete()
      .eq('employee_id', employeeId)
      .eq('pp_end', ppEnd);
    assertNoDbError(deleteError, 'buildTimesheet clear existing');

    if (segments.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('timesheet_segments').insert(segments);
      assertNoDbError(insertError, 'buildTimesheet insert segments');
    }

    const { data: inserted, error: refetchError } = await supabaseAdmin
      .from('timesheet_segments')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('pp_end', ppEnd)
      .order('shift_date', { ascending: true });
    assertNoDbError(refetchError, 'buildTimesheet refetch');

    return (inserted ?? []) as TimesheetSegment[];
  },
};

function buildWorkSegment(
  employeeId: string,
  ppEnd: string,
  shiftDate: string,
  startMin: number,
  endMin: number
): NewSegment {
  const timeOutCrossesMidnight = endMin >= 24 * 60;
  const dateOut = timeOutCrossesMidnight ? addDaysIso(shiftDate, 1) : shiftDate;

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
): NewSegment {
  const endCrossesMidnight = endMin >= 24 * 60;
  const leaveEndDate = endCrossesMidnight ? addDaysIso(shiftDate, 1) : shiftDate;

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
