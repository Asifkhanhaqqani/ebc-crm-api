import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { HttpError } from '../middleware/errorHandler';
import { alSlotService } from '../services/alSlotService';
import { auditService, actorTypeFromRoles } from '../services/auditService';
import { emailService } from '../services/emailService';

const router = Router();

router.use(verifyJWT);

const submitSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type: z.enum(['AL', 'EAL', 'SL', 'ISSL', 'FODI', 'ADM', 'AWOL', 'FL', 'CT', 'CL', 'DET', 'MWA']),
  shift_date: z.string(),
  span_start: z.string(),
  span_end: z.string(),
  reason: z.string().optional(),
  sl_illness: z.boolean().optional(),
  sl_medical: z.boolean().optional(),
  sl_dental: z.boolean().optional(),
  sl_optical: z.boolean().optional(),
  sl_death: z.boolean().optional(),
});

router.post(
  '/',
  strictRateLimiter,
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from('employees')
      .select('platoon')
      .eq('id', body.employee_id)
      .single();
    assertNoDbError(employeeError, 'POST /leave employee lookup');
    if (!employee) {
      throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }

    let status: 'PendingApproval' | 'Waitlist' = 'PendingApproval';

    if (body.leave_type === 'AL') {
      const fit = await alSlotService.checkSlotFit({
        platoon: employee.platoon,
        shiftDate: body.shift_date,
        newStart: body.span_start,
        newEnd: body.span_end,
      });
      status = fit.fits ? 'PendingApproval' : 'Waitlist';
    }

    const entryId = `LV${Date.now()}-${uuidv4().slice(0, 6)}`;

    const { data, error } = await supabaseAdmin
      .from('leave_records')
      .insert({
        entry_id: entryId,
        employee_id: body.employee_id,
        leave_type: body.leave_type,
        shift_date: body.shift_date,
        span_start: body.span_start,
        span_end: body.span_end,
        reason: body.reason ?? null,
        status,
        sl_illness: body.sl_illness ?? false,
        sl_medical: body.sl_medical ?? false,
        sl_dental: body.sl_dental ?? false,
        sl_optical: body.sl_optical ?? false,
        sl_death: body.sl_death ?? false,
      })
      .select('*')
      .single();
    assertNoDbError(error, 'POST /leave insert');

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'leave.submit',
      entryId,
      detail: `${status} · ${body.leave_type} · ${body.shift_date}`,
    });

    const { data: supervisors } = await supabaseAdmin
      .from('roles')
      .select('employee_id')
      .eq('role', 'supervisor');

    await emailService.queueEmail({
      triggerEvent: 'leave.submit',
      entryId,
      recipientIds: (supervisors ?? []).map((s) => s.employee_id),
      subject: `New leave request — ${body.leave_type} · ${body.shift_date}`,
      bodyHtml: `<p>A new ${body.leave_type} request was submitted for ${body.shift_date} (status: ${status}).</p>`,
    });

    ok(res, data, undefined, 201);
  })
);

export default router;
