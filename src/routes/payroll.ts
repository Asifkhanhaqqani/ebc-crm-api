import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { payrollService } from '../services/payrollService';
import { pdfService } from '../services/pdfService';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

const districtParamSchema = z.coerce.number().int();

router.get(
  '/date/:date',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from('payroll_rows')
      .select('*')
      .eq('shift_date', req.params.date);
    assertNoDbError(error, 'GET /payroll/date/:date');
    ok(res, data ?? []);
  })
);

router.post(
  '/date/:date/generate',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const data = await payrollService.buildPayrollForDate(req.params.date);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'payroll.generate',
      entryId: req.params.date,
      detail: `Generated ${data.length} payroll rows for ${req.params.date}`,
    });

    ok(res, data, undefined, 201);
  })
);

router.post(
  '/date/:date/export/:district',
  asyncHandler(async (req, res) => {
    const district = districtParamSchema.parse(req.params.district);
    const url = await pdfService.generatePayrollPdf(req.params.date, district);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'payroll.export',
      entryId: req.params.date,
      detail: `Exported payroll PDF for district ${district}`,
    });

    ok(res, { url });
  })
);

export default router;
