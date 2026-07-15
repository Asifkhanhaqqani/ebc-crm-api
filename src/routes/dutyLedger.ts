import { Router } from 'express';
import { z } from 'zod';
import { verifyJWT, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/respond';
import { dutyLedgerService } from '../services/dutyLedgerService';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

const generateSchema = z.object({ date: z.string() });
const updateSchema = z.object({
  acting_note: z.string().nullable().optional(),
  duty_status: z
    .enum(['O', 'AL', 'SL', 'EAL', 'ISSL', 'FODI', 'ADM', 'AWOL', 'FL', 'CT', 'CL', 'DET', 'MWA', 'OWD'])
    .optional(),
});

router.get(
  '/date/:date',
  asyncHandler(async (req, res) => {
    const data = await dutyLedgerService.getForDate(req.params.date);
    ok(res, data);
  })
);

router.post(
  '/generate',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const { date } = generateSchema.parse(req.body);
    const data = await dutyLedgerService.generateForDate(date);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'duty_ledger.generate',
      entryId: date,
      detail: `Generated ${data.length} duty ledger rows for ${date}`,
    });

    ok(res, data, undefined, 201);
  })
);

router.patch(
  '/:id',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const data = await dutyLedgerService.updateRow(req.params.id, body);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'duty_ledger.update',
      entryId: req.params.id,
      detail: `Updated fields: ${Object.keys(body).join(', ')}`,
    });

    ok(res, data);
  })
);

export default router;
