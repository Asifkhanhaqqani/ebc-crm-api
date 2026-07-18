import { Router } from 'express';
import { supabaseAdmin } from '../config';
import { verifyJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';

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

export default router;
