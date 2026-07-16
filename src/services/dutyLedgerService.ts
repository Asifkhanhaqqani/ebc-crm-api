import { supabaseAdmin } from '../config';
import { assertNoDbError } from '../utils/db';
import { rotationService } from './rotationService';
import { DutyLedgerRow } from '../types';

export const dutyLedgerService = {
  async getForDate(shiftDate: string): Promise<DutyLedgerRow[]> {
    const { data, error } = await supabaseAdmin
      .from('duty_ledger')
      .select('*')
      .eq('shift_date', shiftDate)
      .order('company_code', { ascending: true });
    assertNoDbError(error, 'dutyLedgerService.getForDate');
    return (data ?? []) as DutyLedgerRow[];
  },

  /** Generates one duty_ledger row per active employee whose platoon is on duty that date. */
  async generateForDate(shiftDate: string): Promise<DutyLedgerRow[]> {
    const rotation = await rotationService.getRotationForDate(shiftDate);

    const { data: employees, error: employeesError } = await supabaseAdmin
      .from('employees')
      .select('id, company_code, station_override, platoon, companies!inner(station, station_override)')
      .eq('status', 'Active')
      .eq('platoon', rotation.platoon);
    assertNoDbError(employeesError, 'generateForDate employees lookup');

    const rows = (employees ?? []).map((emp: any) => ({
      shift_date: shiftDate,
      platoon: rotation.platoon,
      employee_id: emp.id,
      company_code: emp.company_code,
      station: emp.station_override ?? emp.companies?.station_override ?? emp.companies?.station ?? '',
      duty_status: 'O' as const,
      shift_start: '07:00',
      shift_end: '07:00',
      hours_worked: 24.0,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('duty_ledger')
        .upsert(rows, { onConflict: 'shift_date,employee_id', ignoreDuplicates: true });
      assertNoDbError(insertError, 'generateForDate insert');
    }

    return dutyLedgerService.getForDate(shiftDate);
  },

  async updateRow(
    id: string,
    patch: Partial<Pick<DutyLedgerRow, 'acting_note' | 'duty_status'>>
  ): Promise<DutyLedgerRow> {
    const { data, error } = await supabaseAdmin
      .from('duty_ledger')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    assertNoDbError(error, 'dutyLedgerService.updateRow');
    return data as DutyLedgerRow;
  },
};
