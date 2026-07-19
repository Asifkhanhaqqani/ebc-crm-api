import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { isCountedForStaffing } from '../services/shiftMath';
import { DutyStatus } from '../types';

const router = Router();

router.use(verifyJWT);

/** Minimum on-duty seats required per company, parsed from suffix_rule ("8 · Capt+OP+2"). */
function requiredSeats(suffixRule: string | null): number {
  if (!suffixRule) return 1;
  const match = suffixRule.match(/^(\d+)/);
  return match ? Number(match[1]) : 1;
}

// Same seniority order used on the frontend roster/rank dropdowns — keeps
// each station's employee list sorted chain-of-command style (Capt, LT, OP,
// FF) rather than alphabetically.
const RANK_ORDER = [
  'AC', 'Sub-AC', 'DC', 'Sub-DC', 'Capt', 'Sub-CAPT',
  'LT', 'Sub-LT', 'OP', 'Sub-OP', 'FF', 'Sub-FF',
];
function rankIndex(rank: string): number {
  const idx = RANK_ORDER.indexOf(rank);
  return idx === -1 ? RANK_ORDER.length : idx;
}

const queryQuerySchema = z.object({ platoon: z.enum(['A', 'B', 'C']).optional() });

interface DutyLedgerJoined {
  employee_id: string;
  company_code: string;
  platoon: string;
  duty_status: string;
  acting_note: string | null;
  hours_worked: string;
  employees: {
    emp_number: number;
    last_name: string;
    first_name: string;
    rank: string;
  };
}

router.get(
  '/date/:date',
  asyncHandler(async (req, res) => {
    const { platoon } = queryQuerySchema.parse(req.query);
    const shiftDate = req.params.date;

    const { data: companies, error: companiesError } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('records_only', false);
    assertNoDbError(companiesError, 'GET /workforce companies');

    let dutyQuery = supabaseAdmin
      .from('duty_ledger')
      .select('employee_id, company_code, platoon, duty_status, acting_note, hours_worked, employees!inner(emp_number, last_name, first_name, rank)')
      .eq('shift_date', shiftDate);
    if (platoon) dutyQuery = dutyQuery.eq('platoon', platoon);
    const { data: dutyRows, error: dutyError } = await dutyQuery;
    assertNoDbError(dutyError, 'GET /workforce duty_ledger');

    // Approved details only — a Pending/Denied/Cancelled one isn't real
    // incoming coverage. detail_location is free text with no FK back to
    // companies, so matching it to a receiving station is a best-effort
    // substring match, not a guaranteed one.
    const { data: detRows, error: detError } = await supabaseAdmin
      .from('det_records')
      .select('employee_id, detail_location')
      .eq('shift_date', shiftDate)
      .eq('status', 'Approved');
    assertNoDbError(detError, 'GET /workforce det_records');

    const { data: leaveRows, error: leaveError } = await supabaseAdmin
      .from('leave_records')
      .select('employee_id, leave_type, reason')
      .eq('shift_date', shiftDate)
      .in('status', ['Granted', 'Active']);
    assertNoDbError(leaveError, 'GET /workforce leave_records');

    const detByEmployee = new Map((detRows ?? []).map((d) => [d.employee_id as string, d]));
    const leaveByEmployee = new Map((leaveRows ?? []).map((l) => [l.employee_id as string, l]));

    const rows = ((dutyRows ?? []) as unknown as DutyLedgerJoined[]);

    const report = (companies ?? []).map((company) => {
      const companyRows = rows.filter((d) => d.company_code === company.code);
      const onDutyCount = companyRows.filter((d) => isCountedForStaffing(d.duty_status as DutyStatus)).length;
      const required = requiredSeats(company.suffix_rule);
      const shortage = Math.max(0, required - onDutyCount);

      const detOut = companyRows.filter((d) => d.duty_status === 'DET').length;
      const mwaCount = companyRows.filter((d) => (d.acting_note ?? '').toUpperCase().includes('MWA')).length;
      const otCount = companyRows.filter((d) => (d.acting_note ?? '').toUpperCase().includes('OT')).length;

      const codeLower = company.code.toLowerCase();
      const stationLower = company.station.toLowerCase();
      const detIn = (detRows ?? []).filter((d) => {
        const loc = d.detail_location.toLowerCase();
        return loc.includes(codeLower) || loc.includes(stationLower);
      }).length;

      const employees = companyRows
        .map((d) => {
          const emp = d.employees;
          const detFlag = d.duty_status === 'DET';
          const actingNote = d.acting_note ?? '';
          const mwaFlag = actingNote.toUpperCase().includes('MWA');
          const otFlag = actingNote.toUpperCase().includes('OT');

          let notes: string | null = null;
          if (detFlag) {
            const det = detByEmployee.get(d.employee_id);
            notes = det ? `DET: ${det.detail_location}` : d.acting_note || 'On detail';
          } else if (mwaFlag || otFlag) {
            notes = d.acting_note;
          } else if (d.duty_status !== 'O' && d.duty_status !== 'Train') {
            const leave = leaveByEmployee.get(d.employee_id);
            notes = leave?.reason || d.duty_status;
          }

          return {
            employee_id: d.employee_id,
            emp_number: emp.emp_number,
            last_name: emp.last_name,
            first_name: emp.first_name,
            rank: emp.rank,
            duty_status: d.duty_status,
            acting_note: d.acting_note,
            hours_worked: d.hours_worked,
            det_flag: detFlag,
            mwa_flag: mwaFlag,
            ot_flag: otFlag,
            notes,
          };
        })
        .sort((a, b) => rankIndex(a.rank) - rankIndex(b.rank) || a.last_name.localeCompare(b.last_name));

      return {
        company_code: company.code,
        station: company.station,
        district: company.district,
        required_seats: required,
        on_duty_count: onDutyCount,
        total_assigned: companyRows.length,
        det_out: detOut,
        det_in: detIn,
        mwa_count: mwaCount,
        ot_count: otCount,
        shortage,
        shortage_flag: shortage > 0,
        employees,
      };
    });

    ok(res, report);
  })
);

export default router;
