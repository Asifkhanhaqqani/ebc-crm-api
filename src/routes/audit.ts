import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';

const router = Router();

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  before: z.string().optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().optional(),
});

router.use(verifyJWT, requireRole('supervisor'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    let query = supabaseAdmin.from('audit_log').select('*', { count: 'exact' });

    if (q.before) query = query.lt('occurred_at', q.before);
    if (q.actor_id) query = query.eq('actor_id', q.actor_id);
    if (q.action) query = query.eq('action', q.action);

    const { data, error, count } = await query
      .order('occurred_at', { ascending: false })
      .limit(q.limit);
    assertNoDbError(error, 'GET /audit');

    ok(res, data ?? [], { total: count ?? 0, page: 1, limit: q.limit });
  })
);

export default router;
