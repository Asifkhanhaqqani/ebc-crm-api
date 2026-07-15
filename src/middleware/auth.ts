import { NextFunction, Request, Response } from 'express';
import { supabaseAdmin, supabaseAnon } from '../config';
import { ApiError, AppRole, AuthedUser } from '../types';
import { logger } from '../logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

function unauthorized(res: Response, message = 'Missing or invalid authentication token') {
  const body: ApiError = { success: false, error: { code: 'UNAUTHORIZED', message } };
  return res.status(401).json(body);
}

export async function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return unauthorized(res);
  }

  const token = header.slice('Bearer '.length);

  try {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (error || !data.user) {
      return unauthorized(res);
    }

    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('email', data.user.email)
      .maybeSingle();

    let roles: AppRole[] = [];
    if (employee?.id) {
      const { data: roleRows } = await supabaseAdmin
        .from('roles')
        .select('role')
        .eq('employee_id', employee.id);
      roles = (roleRows ?? []).map((r) => r.role as AppRole);
    }

    req.user = {
      userId: data.user.id,
      employeeId: employee?.id ?? null,
      roles,
    };

    return next();
  } catch (err) {
    logger.error('verifyJWT failed', { err });
    return unauthorized(res);
  }
}

export function requireRole(role: AppRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.roles.includes(role)) {
      const body: ApiError = {
        success: false,
        error: { code: 'FORBIDDEN', message: `Requires role: ${role}` },
      };
      return res.status(403).json(body);
    }
    return next();
  };
}
