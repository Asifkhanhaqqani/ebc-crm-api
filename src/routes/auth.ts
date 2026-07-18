import { Router } from 'express';
import { verifyJWT } from '../middleware/auth';
import { ok } from '../utils/respond';

const router = Router();

router.use(verifyJWT);

// Lets the frontend know the caller's own roles so it can show/hide
// supervisor-only UI (e.g. the Roster page's add/edit/deactivate controls)
// without guessing — the backend already enforces these via requireRole()
// on the actual mutating routes, this just mirrors that for rendering.
router.get('/me', (req, res) => {
  ok(res, {
    employeeId: req.user!.employeeId,
    roles: req.user!.roles,
  });
});

export default router;
