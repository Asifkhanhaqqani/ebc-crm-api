import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { auditService, actorTypeFromRoles } from '../services/auditService';

const router = Router();

const listQuerySchema = z.object({
  platoon: z.enum(['A', 'B', 'C']).optional(),
  rank: z.string().optional(),
  station: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const createSchema = z.object({
  emp_number: z.number().int(),
  last_name: z.string().min(1),
  first_name: z.string().min(1),
  middle_initial: z.string().length(1).nullable().optional(),
  rank: z.enum(['AC', 'Sub-AC', 'DC', 'Sub-DC', 'Capt', 'Sub-CAPT', 'LT', 'Sub-LT', 'OP', 'Sub-OP', 'FF', 'Sub-FF']),
  platoon: z.enum(['A', 'B', 'C']),
  company_code: z.string().min(1),
  station_override: z.string().nullable().optional(),
  dc_initial: z.string().nullable().optional(),
  supervisor: z.boolean().optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
  email: z.string().email().nullable().optional(),
});

const updateSchema = createSchema.partial();

router.use(verifyJWT);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    let query = supabaseAdmin.from('employees').select('*', { count: 'exact' });

    if (q.platoon) query = query.eq('platoon', q.platoon);
    if (q.rank) query = query.eq('rank', q.rank);
    if (q.station) query = query.or(`station_override.eq.${q.station}`);
    if (q.search) {
      query = query.or(`last_name.ilike.%${q.search}%,first_name.ilike.%${q.search}%`);
    }

    const from = (q.page - 1) * q.limit;
    const to = from + q.limit - 1;
    query = query.range(from, to).order('last_name', { ascending: true });

    const { data, error, count } = await query;
    assertNoDbError(error, 'GET /employees');

    ok(res, data ?? [], { total: count ?? 0, page: q.page, limit: q.limit });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('*')
      .eq('id', req.params.id)
      .single();
    assertNoDbError(error, 'GET /employees/:id');
    ok(res, data);
  })
);

router.post(
  '/',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const { data, error } = await supabaseAdmin.from('employees').insert(body).select('*').single();
    assertNoDbError(error, 'POST /employees');

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'employee.create',
      entryId: data.id,
      detail: `Created employee ${body.first_name} ${body.last_name} (#${body.emp_number})`,
    });

    ok(res, data, undefined, 201);
  })
);

router.patch(
  '/:id',
  requireRole('supervisor'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('employees')
      .update(body)
      .eq('id', req.params.id)
      .select('*')
      .single();
    assertNoDbError(error, 'PATCH /employees/:id');

    await auditService.write({
      actorType: actorTypeFromRoles(req.user!.roles),
      actorId: req.user!.employeeId ?? undefined,
      action: 'employee.update',
      entryId: req.params.id,
      detail: `Updated fields: ${Object.keys(body).join(', ')}`,
    });

    ok(res, data);
  })
);

export default router;
