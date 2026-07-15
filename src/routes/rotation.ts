import { Router } from 'express';
import { verifyJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/respond';
import { rotationService } from '../services/rotationService';

const router = Router();

router.use(verifyJWT);

router.get(
  '/date/:date',
  asyncHandler(async (req, res) => {
    const data = await rotationService.getRotationForDate(req.params.date);
    ok(res, data);
  })
);

router.get(
  '/period/:pp_end',
  asyncHandler(async (req, res) => {
    const data = await rotationService.getPeriodDays(req.params.pp_end);
    ok(res, data);
  })
);

export default router;
