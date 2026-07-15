import { Router } from 'express';
import { z } from 'zod';
import { verifyJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/respond';
import { timesheetService } from '../services/timesheetService';
import { pdfService } from '../services/pdfService';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

const queryQuerySchema = z.object({ pp_end: z.string() });

router.get(
  '/:employee_id',
  asyncHandler(async (req, res) => {
    const { pp_end } = queryQuerySchema.parse(req.query);
    const data = await timesheetService.buildTimesheet(req.params.employee_id, pp_end);
    ok(res, data);
  })
);

router.post(
  '/:employee_id/export',
  asyncHandler(async (req, res) => {
    const { pp_end } = queryQuerySchema.parse(req.query);
    const url = await pdfService.generateTimesheetPdf(req.params.employee_id, pp_end);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'timesheet.export',
      entryId: req.params.employee_id,
      detail: `Exported timesheet PDF for pay period ending ${pp_end}`,
    });

    ok(res, { url });
  })
);

export default router;
