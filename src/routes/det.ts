import { Router } from 'express';
import { z } from 'zod';
import { verifyJWT, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/respond';
import { detService } from '../services/detService';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM');

const createSchema = z.object({
  employee_id: z.string().uuid(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  detail_location: z.string().min(1),
  span_start: timeString,
  span_end: timeString,
  reason: z.string().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(['PendingApproval', 'Approved', 'Denied', 'Cancelled']),
});

router.get(
  '/date/:date',
  asyncHandler(async (req, res) => {
    const data = await detService.listForDate(req.params.date);
    ok(res, data);
  })
);

router.post(
  '/',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const data = await detService.create(body);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'det.create',
      entryId: data.id,
      detail: `${body.detail_location} ${body.span_start}–${body.span_end} on ${body.shift_date}`,
    });

    ok(res, data, undefined, 201);
  })
);

router.patch(
  '/:id/status',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const data = await detService.updateStatus(req.params.id, status);

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'det.status',
      entryId: req.params.id,
      detail: `Status → ${status}`,
    });

    ok(res, data);
  })
);

export default router;
