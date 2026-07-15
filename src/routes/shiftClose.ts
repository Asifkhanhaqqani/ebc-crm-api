import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { auditService, actorTypeFromRoles } from '../services/auditService';
import { emailService } from '../services/emailService';

const router = Router();

router.use(verifyJWT);

const closeSchema = z.object({
  shift_date: z.string(),
  station: z.string(),
  platoon: z.enum(['A', 'B', 'C']),
  entries: z
    .array(
      z.object({
        duty_ledger_id: z.string().uuid(),
        shift_end: z.string().optional(),
        acting_note: z.string().nullable().optional(),
      })
    )
    .default([]),
});

router.get(
  '/date/:date/station/:station',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from('shift_close')
      .select('*')
      .eq('shift_date', req.params.date)
      .eq('station', req.params.station)
      .maybeSingle();
    assertNoDbError(error, 'GET /shift-close');
    ok(res, data);
  })
);

router.post(
  '/',
  requireRole('supervisor'),
  strictRateLimiter,
  asyncHandler(async (req, res) => {
    const body = closeSchema.parse(req.body);

    let correctionCount = 0;
    for (const entry of body.entries) {
      const patch: Record<string, unknown> = { is_closed: true, closed_at: new Date().toISOString() };
      if (entry.shift_end) {
        patch.shift_end = entry.shift_end;
        correctionCount += 1;
      }
      if (entry.acting_note !== undefined) {
        patch.acting_note = entry.acting_note;
      }
      const { error: updateError } = await supabaseAdmin
        .from('duty_ledger')
        .update(patch)
        .eq('id', entry.duty_ledger_id);
      assertNoDbError(updateError, 'POST /shift-close duty_ledger update');
    }

    const { data: closeRow, error } = await supabaseAdmin
      .from('shift_close')
      .insert({
        shift_date: body.shift_date,
        station: body.station,
        platoon: body.platoon,
        supervisor_id: req.user!.employeeId,
        correction_count: correctionCount,
      })
      .select('*')
      .single();
    assertNoDbError(error, 'POST /shift-close insert');

    const { data: dcs } = await supabaseAdmin.from('employees').select('id').eq('rank', 'DC');
    await emailService.queueEmail({
      triggerEvent: 'shift.close',
      entryId: closeRow.id,
      recipientIds: (dcs ?? []).map((d) => d.id),
      subject: `Shift closed — ${body.station} · ${body.shift_date}`,
      bodyHtml: `<p>${body.station} closed the ${body.platoon} platoon shift for ${body.shift_date} (${correctionCount} corrections).</p>`,
    });
    await emailService.flushOutbox();

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'shift.close',
      entryId: closeRow.id,
      detail: `${body.station} · ${body.shift_date} · ${correctionCount} corrections`,
    });

    ok(res, closeRow, undefined, 201);
  })
);

export default router;
