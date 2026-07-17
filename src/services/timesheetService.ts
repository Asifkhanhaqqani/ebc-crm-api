import { supabaseAdmin } from '../config';
import { assertNoDbError } from '../utils/db';
import { rotationService } from './rotationService';
import { computeDaySegments, LeaveSpan } from './shiftMath';
import { TimesheetSegment } from '../types';

export const timesheetService = {
  async buildTimesheet(employeeId: string, ppEnd: string): Promise<TimesheetSegment[]> {
    // Period membership comes from rotation_schedule's pp_end key: a pay
    // period covers only the 14 shift dates BEFORE its Saturday 07:00 end
    // boundary. Segment math in shiftMath clamps every segment to the 24-hour
    // shift window, so no hours can bleed past that boundary.
    const periodDays = await rotationService.getPeriodDays(ppEnd);
    const segments: ReturnType<typeof computeDaySegments> = [];

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

      segments.push(
        ...computeDaySegments(employeeId, ppEnd, shiftDate, (leaves ?? []) as LeaveSpan[])
      );
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
