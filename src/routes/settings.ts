import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

const updateSchema = z.object({ value: z.string() });

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('settings').select('*').order('key');
    assertNoDbError(error, 'GET /settings');
    ok(res, data ?? []);
  })
);

router.patch(
  '/:key',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { value } = updateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('settings')
      .update({ value, updated_by: req.user!.employeeId })
      .eq('key', req.params.key)
      .select('*')
      .single();
    assertNoDbError(error, 'PATCH /settings/:key');

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'settings.update',
      entryId: req.params.key,
      detail: `Set ${req.params.key} = ${value}`,
    });

    ok(res, data);
  })
);

export default router;
