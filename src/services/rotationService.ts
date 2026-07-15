import { supabaseAdmin } from '../config';
import { HttpError } from '../middleware/errorHandler';
import { RotationDay } from '../types';
import { assertNoDbError } from '../utils/db';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

function withShiftWindow(row: RotationDay): RotationDay {
  return {
    ...row,
    shift_window_start: `${row.shift_date}T07:00:00-06:00`,
    shift_window_end: `${addDays(row.shift_date, 1)}T07:00:00-06:00`,
  };
}

export const rotationService = {
  async getRotationForDate(dateStr: string): Promise<RotationDay> {
    const { data, error } = await supabaseAdmin
      .from('rotation_schedule')
      .select('*')
      .eq('shift_date', dateStr)
      .maybeSingle();

    assertNoDbError(error, 'getRotationForDate');
    if (!data) {
      throw new HttpError(404, 'ROTATION_NOT_FOUND', `No rotation entry for ${dateStr}`);
    }

    return withShiftWindow(data as RotationDay);
  },

  async getPeriodDays(ppEnd: string): Promise<RotationDay[]> {
    const { data, error } = await supabaseAdmin
      .from('rotation_schedule')
      .select('*')
      .eq('pp_end', ppEnd)
      .order('shift_date', { ascending: true });

    assertNoDbError(error, 'getPeriodDays');
    return (data ?? []).map((row) => withShiftWindow(row as RotationDay));
  },
};
