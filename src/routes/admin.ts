import { Router } from 'express';
import { z } from 'zod';
import { config, supabaseAdmin } from '../config';
import { verifyJWT, requireRole } from '../middleware/auth';
import { HttpError } from '../middleware/errorHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { assertNoDbError } from '../utils/db';
import { ok } from '../utils/respond';
import { auditService } from '../services/auditService';
import { emailService } from '../services/emailService';

const router = Router();

/** Next local-time occurrence of `HH:MM` in `timezone`, using Intl (no extra tz dependency). */
function nextScheduledRun(timeHHMM: string, timezone: string): string {
  const [hh, mm] = timeHHMM.split(':').map(Number);
  const now = new Date();

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value])) as Record<string, string>;
  const pad = (n: number) => String(n).padStart(2, '0');

  const nowLocal = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:00`);
  const todayRun = new Date(`${parts.year}-${parts.month}-${parts.day}T${pad(hh)}:${pad(mm)}:00`);
  const next = nowLocal < todayRun ? todayRun : new Date(todayRun.getTime() + 24 * 60 * 60 * 1000);

  return `${next.toISOString().slice(0, 16).replace('T', ' ')} ${timezone}`;
}

router.use(verifyJWT);

// No role required — lets any logged-in user (including one with zero roles,
// who can't call anything else here) know whether the "Make Me Admin" setup
// prompt should be shown, without exposing anything beyond a boolean.
router.get(
  '/bootstrap-status',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('roles').select('id').eq('role', 'admin').limit(1).maybeSingle();
    assertNoDbError(error, 'GET /admin/bootstrap-status');
    ok(res, { adminExists: Boolean(data) });
  })
);

// --------------------------------------------------------------------------
// First-admin bootstrap
// --------------------------------------------------------------------------
//
// The spec asks for this to work "without auth check" whenever zero admins
// exist. A route with literally no authentication at all would let anyone on
// the public internet grant admin (to any email, before a legitimate admin
// ever runs setup) — so this still requires a valid logged-in session
// (verifyJWT, applied above) and only ever grants the role to the caller's
// OWN authenticated email, never an arbitrary body-supplied one. It still
// has no *role* requirement, which is the actual bootstrapping need: nobody
// has a role yet, so requireRole('admin') would always fail here.
const setupFirstAdminSchema = z.object({ email: z.string().email() });

router.post(
  '/setup-first-admin',
  asyncHandler(async (req, res) => {
    const { email } = setupFirstAdminSchema.parse(req.body);

    if (!req.user!.email || req.user!.email.toLowerCase() !== email.toLowerCase()) {
      throw new HttpError(403, 'FORBIDDEN', 'You can only set up your own account as the first admin.');
    }

    const { data: existingAdmin, error: adminCheckError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();
    assertNoDbError(adminCheckError, 'setup-first-admin admin check');

    if (existingAdmin) {
      throw new HttpError(403, 'ADMIN_EXISTS', 'Admin already configured');
    }

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    assertNoDbError(employeeError, 'setup-first-admin employee lookup');

    if (!employee) {
      throw new HttpError(
        404,
        'EMPLOYEE_NOT_FOUND',
        'No employee record matches this email. Ask an existing admin to add you to the roster (with this email) first.'
      );
    }

    const { error: insertError } = await supabaseAdmin.from('roles').insert([
      { employee_id: employee.id, role: 'admin' },
      { employee_id: employee.id, role: 'supervisor' },
    ]);
    assertNoDbError(insertError, 'setup-first-admin role insert');

    await auditService.write({
      actorType: 'admin',
      actorId: employee.id,
      action: 'admin.first_setup',
      entryId: employee.id,
      detail: `First-admin bootstrap: granted admin + supervisor to ${email}`,
    });

    ok(res, { employeeId: employee.id, roles: ['admin', 'supervisor'] }, undefined, 201);
  })
);

// Everything below requires an assigned admin role.
router.use(requireRole('admin'));

// --------------------------------------------------------------------------
// Role assignments
// --------------------------------------------------------------------------

router.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from('roles')
      .select('*, employees(last_name, first_name, emp_number, email)')
      .order('assigned_at', { ascending: false });
    assertNoDbError(error, 'GET /admin/roles');
    ok(res, data ?? []);
  })
);

const assignRoleSchema = z.object({
  employee_id: z.string().uuid(),
  role: z.enum(['admin', 'supervisor', 'member']),
});

router.post(
  '/roles',
  asyncHandler(async (req, res) => {
    const body = assignRoleSchema.parse(req.body);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('employee_id', body.employee_id)
      .eq('role', body.role)
      .maybeSingle();
    assertNoDbError(existingError, 'POST /admin/roles dupe check');
    if (existing) {
      throw new HttpError(409, 'ROLE_EXISTS', 'This employee already has that role.');
    }

    const { data, error } = await supabaseAdmin
      .from('roles')
      .insert({ employee_id: body.employee_id, role: body.role, assigned_by: req.user!.employeeId })
      .select('*, employees(last_name, first_name, emp_number, email)')
      .single();
    assertNoDbError(error, 'POST /admin/roles');

    await auditService.write({
      actorType: 'admin',
      actorId: req.user!.employeeId ?? undefined,
      action: 'role.assign',
      entryId: data.id,
      detail: `Assigned role ${body.role} to employee ${body.employee_id}`,
    });

    ok(res, data, undefined, 201);
  })
);

router.delete(
  '/roles/:id',
  asyncHandler(async (req, res) => {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('roles')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    assertNoDbError(existingError, 'DELETE /admin/roles/:id lookup');
    if (!existing) {
      throw new HttpError(404, 'NOT_FOUND', 'Role assignment not found');
    }

    const { error } = await supabaseAdmin.from('roles').delete().eq('id', req.params.id);
    assertNoDbError(error, 'DELETE /admin/roles/:id');

    await auditService.write({
      actorType: 'admin',
      actorId: req.user!.employeeId ?? undefined,
      action: 'role.remove',
      entryId: req.params.id,
      detail: `Removed role ${existing.role} from employee ${existing.employee_id}`,
    });

    ok(res, { removed: true });
  })
);

// --------------------------------------------------------------------------
// Supabase auth users
// --------------------------------------------------------------------------

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
      throw new HttpError(500, 'AUTH_ADMIN_ERROR', error.message);
    }

    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));
    ok(res, users);
  })
);

// --------------------------------------------------------------------------
// System info — read-only facts for the Notifications / Duty Board Config tabs
// --------------------------------------------------------------------------

router.get(
  '/system-info',
  asyncHandler(async (_req, res) => {
    const { data: earliest, error: earliestError } = await supabaseAdmin
      .from('rotation_schedule')
      .select('shift_date')
      .order('shift_date', { ascending: true })
      .limit(1);
    assertNoDbError(earliestError, 'system-info rotation min');

    const { data: latest, error: latestError } = await supabaseAdmin
      .from('rotation_schedule')
      .select('shift_date')
      .order('shift_date', { ascending: false })
      .limit(1);
    assertNoDbError(latestError, 'system-info rotation max');

    const { count: rotationDays, error: countError } = await supabaseAdmin
      .from('rotation_schedule')
      .select('*', { count: 'exact', head: true });
    assertNoDbError(countError, 'system-info rotation count');

    const { data: settingsRows, error: settingsError } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', ['packet_email_time', 'timezone']);
    assertNoDbError(settingsError, 'system-info settings');
    const settingsMap = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, s.value]));
    const packetTime = settingsMap.packet_email_time ?? '08:15';
    const timezone = settingsMap.timezone ?? 'America/Chicago';

    ok(res, {
      emailProvider: config.RESEND_API_KEY ? 'Resend API' : 'Not configured',
      rotationRange: {
        start: earliest?.[0]?.shift_date ?? null,
        end: latest?.[0]?.shift_date ?? null,
        days: rotationDays ?? 0,
      },
      timezone,
      nextPacketRun: nextScheduledRun(packetTime, timezone),
    });
  })
);

// --------------------------------------------------------------------------
// Notification rules
// --------------------------------------------------------------------------

router.get(
  '/notification-rules',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('notification_rules').select('*').order('event');
    assertNoDbError(error, 'GET /admin/notification-rules');
    ok(res, data ?? []);
  })
);

const updateRuleSchema = z.object({
  enabled: z.boolean().optional(),
  recipients: z.string().min(1).optional(),
});

router.patch(
  '/notification-rules/:event',
  asyncHandler(async (req, res) => {
    const body = updateRuleSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('notification_rules')
      .update({ ...body, updated_at: new Date().toISOString(), updated_by: req.user!.employeeId })
      .eq('event', req.params.event)
      .select('*')
      .single();
    assertNoDbError(error, 'PATCH /admin/notification-rules/:event');

    await auditService.write({
      actorType: 'admin',
      actorId: req.user!.employeeId ?? undefined,
      action: 'notification_rule.update',
      entryId: req.params.event,
      detail: `Updated fields: ${Object.keys(body).join(', ')}`,
    });

    ok(res, data);
  })
);

// --------------------------------------------------------------------------
// Test email
// --------------------------------------------------------------------------

const testEmailSchema = z.object({ to: z.string().email() });

router.post(
  '/test-email',
  asyncHandler(async (req, res) => {
    const { to } = testEmailSchema.parse(req.body);

    try {
      await emailService.sendTestEmail(to);
    } catch (err) {
      throw new HttpError(400, 'EMAIL_SEND_FAILED', err instanceof Error ? err.message : 'Failed to send test email');
    }

    await auditService.write({
      actorType: 'admin',
      actorId: req.user!.employeeId ?? undefined,
      action: 'email.test_sent',
      detail: `Test email sent to ${to}`,
    });

    ok(res, { sent: true });
  })
);

export default router;
