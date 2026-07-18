import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { HttpError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { auditService } from '../services/auditService';

const router = Router();

router.use(verifyJWT);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('companies').select('*').order('code');
    assertNoDbError(error, 'GET /companies');
    ok(res, data ?? []);
  })
);

const districtSchema = z.union([z.literal(120), z.literal(140), z.literal(160)]).nullable();

const createCompanySchema = z.object({
  code: z.string().min(1).max(10),
  station: z.string().min(1),
  district: districtSchema.optional(),
  suffix_rule: z.string().nullable().optional(),
  records_only: z.boolean().optional(),
  station_override: z.string().nullable().optional(),
});

const updateCompanySchema = createCompanySchema.omit({ code: true }).partial();

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = createCompanySchema.parse(req.body);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('companies')
      .select('code')
      .eq('code', body.code)
      .maybeSingle();
    assertNoDbError(existingError, 'POST /companies dupe check');
    if (existing) {
      throw new HttpError(409, 'COMPANY_EXISTS', `Company code ${body.code} already exists.`);
    }

    const { data, error } = await supabaseAdmin.from('companies').insert(body).select('*').single();
    assertNoDbError(error, 'POST /companies');

    await auditService.write({
      actorType: 'admin',
      actorId: req.user!.employeeId ?? undefined,
      action: 'company.create',
      entryId: data.code,
      detail: `Created company ${data.code} (${data.station})`,
    });

    ok(res, data, undefined, 201);
  })
);

router.patch(
  '/:code',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = updateCompanySchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('companies')
      .update(body)
      .eq('code', req.params.code)
      .select('*')
      .single();
    assertNoDbError(error, 'PATCH /companies/:code');

    await auditService.write({
      actorType: 'admin',
      actorId: req.user!.employeeId ?? undefined,
      action: 'company.update',
      entryId: req.params.code,
      detail: `Updated fields: ${Object.keys(body).join(', ')}`,
    });

    ok(res, data);
  })
);

export default router;
