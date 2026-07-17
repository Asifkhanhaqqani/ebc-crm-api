import { Router } from 'express';
import { supabaseAdmin } from '../config';
import { verifyJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { isCountedForStaffing } from '../services/shiftMath';

const router = Router();

router.use(verifyJWT);

/** Minimum on-duty seats required per company, parsed from suffix_rule ("8 · Capt+OP+2"). */
function requiredSeats(suffixRule: string | null): number {
  if (!suffixRule) return 1;
  const match = suffixRule.match(/^(\d+)/);
  return match ? Number(match[1]) : 1;
}

router.get(
  '/date/:date',
  asyncHandler(async (req, res) => {
    const { data: companies, error: companiesError } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('records_only', false);
    assertNoDbError(companiesError, 'GET /workforce companies');

    const { data: dutyRows, error: dutyError } = await supabaseAdmin
      .from('duty_ledger')
      .select('*')
      .eq('shift_date', req.params.date);
    assertNoDbError(dutyError, 'GET /workforce duty_ledger');

    const report = (companies ?? []).map((company) => {
      const rows = (dutyRows ?? []).filter((d) => d.company_code === company.code);
      // Train (and every leave/detail status) stays listed in `roster` but is
      // excluded from the on-duty count, so a station can go short over Train.
      const onDutyCount = rows.filter((d) => isCountedForStaffing(d.duty_status)).length;
      const required = requiredSeats(company.suffix_rule);
      const shortage = Math.max(0, required - onDutyCount);

      return {
        company_code: company.code,
        station: company.station,
        district: company.district,
        required_seats: required,
        on_duty_count: onDutyCount,
        total_assigned: rows.length,
        shortage,
        shortage_flag: shortage > 0,
        roster: rows,
      };
    });

    ok(res, report);
  })
);

export default router;
