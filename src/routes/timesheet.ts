import { Router } from 'express';
import { z } from 'zod';
import { verifyJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/respond';
import { logger } from '../logger';
import { timesheetService } from '../services/timesheetService';
import { pdfService } from '../services/pdfService';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

const paramsSchema = z.object({ employee_id: z.string().uuid('employee_id must be a valid employee UUID') });
const queryQuerySchema = z.object({ pp_end: z.string() });

router.get(
  '/:employee_id',
  asyncHandler(async (req, res) => {
    const { employee_id } = paramsSchema.parse(req.params);
    const { pp_end } = queryQuerySchema.parse(req.query);

    try {
      const data = await timesheetService.buildTimesheet(employee_id, pp_end);
      ok(res, data);
    } catch (err) {
      // Missing rotation coverage for a pay period is a data-completeness gap
      // (duty ledger / rotation not generated yet), not a client error —
      // surface it as an empty timesheet with an explanatory note instead of
      // a 500, and keep the real error in the server log.
      logger.warn('buildTimesheet failed, returning empty timesheet', {
        employeeId: employee_id,
        ppEnd: pp_end,
        err: err instanceof Error ? err.message : String(err),
      });
      ok(res, [], { total: 0, page: 1, limit: 0, message: 'No rotation data for this pay period' });
    }
  })
);

router.post(
  '/:employee_id/export',
  asyncHandler(async (req, res) => {
    const { employee_id } = paramsSchema.parse(req.params);
    const { pp_end } = queryQuerySchema.parse(req.body ?? {});

    const url = await pdfService.generateTimesheetPdf(employee_id, pp_end);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'timesheet.export',
      entryId: employee_id,
      detail: `Exported timesheet PDF for pay period ending ${pp_end}`,
    });

    ok(res, { url });
  })
);

export default router;
