import { supabaseAdmin } from '../config';
import { HttpError } from '../middleware/errorHandler';
import { assertNoDbError } from '../utils/db';
import { normalizeSpanToShiftWindow } from './shiftMath';
import { DetRecord } from '../types';

export interface NewDetRecord {
  employee_id: string;
  shift_date: string;
  detail_location: string;
  span_start: string;
  span_end: string;
  reason?: string | null;
}

/** Postgres SQLSTATE for an exclusion-constraint violation. */
const EXCLUSION_VIOLATION = '23P01';
/** SQLSTATE raised by the block_det_during_leave trigger. */
const RAISE_EXCEPTION = 'P0001';

export const detService = {
  async create(record: NewDetRecord): Promise<DetRecord> {
    const { data, error } = await supabaseAdmin
      .from('det_records')
      .insert({ ...record, reason: record.reason ?? null })
      .select('*')
      .single();

    if (error) {
      if (error.code === EXCLUSION_VIOLATION) {
        throw new HttpError(409, 'DOUBLE_BOOKED', await describeOverlap(record));
      }
      if (error.code === RAISE_EXCEPTION && error.message.includes('LEAVE_CONFLICT')) {
        throw new HttpError(409, 'LEAVE_CONFLICT', error.message.replace(/^.*LEAVE_CONFLICT:\s*/, ''));
      }
    }
    assertNoDbError(error, 'detService.create');
    return data as DetRecord;
  },

  async listForDate(shiftDate: string): Promise<DetRecord[]> {
    const { data, error } = await supabaseAdmin
      .from('det_records')
      .select('*')
      .eq('shift_date', shiftDate)
      .order('span_start', { ascending: true });
    assertNoDbError(error, 'detService.listForDate');
    return (data ?? []) as DetRecord[];
  },

  async updateStatus(id: string, status: DetRecord['status']): Promise<DetRecord> {
    const { data, error } = await supabaseAdmin
      .from('det_records')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();
    assertNoDbError(error, 'detService.updateStatus');
    return data as DetRecord;
  },
};

/**
 * Best-effort lookup of the record that caused a det_records_no_overlap
 * violation, so the 409 names the conflicting station and time range for the
 * supervisor. Falls back to a generic message if it can't be pinpointed.
 */
async function describeOverlap(record: NewDetRecord): Promise<string> {
  const generic =
    `Overlapping duty assignment: employee is already detailed elsewhere during ` +
    `${record.span_start}–${record.span_end} on ${record.shift_date}. ` +
    'Sequential assignments are allowed; overlapping ones are not.';

  const requested = normalizeSpanToShiftWindow(record);
  if (!requested) return generic;

  const { data: existing } = await supabaseAdmin
    .from('det_records')
    .select('detail_location, span_start, span_end, shift_date')
    .eq('employee_id', record.employee_id)
    .eq('shift_date', record.shift_date)
    .in('status', ['PendingApproval', 'Approved']);

  for (const det of existing ?? []) {
    const span = normalizeSpanToShiftWindow(det);
    if (span && span.startMin < requested.endMin && requested.startMin < span.endMin) {
      return (
        `Overlapping duty assignment: employee is already detailed to ${det.detail_location} ` +
        `${det.span_start}–${det.span_end} on ${det.shift_date}, which overlaps the requested ` +
        `${record.span_start}–${record.span_end}. Sequential assignments are allowed; ` +
        'overlapping ones are not.'
      );
    }
  }
  return generic;
}
