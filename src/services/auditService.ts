import { supabaseAdmin } from '../config';
import { logger } from '../logger';
import { AppRole } from '../types';

interface WriteAuditParams {
  actorType: 'member' | 'supervisor' | 'admin' | 'system';
  actorId?: string;
  action: string;
  entryId?: string;
  detail: string;
}

/** Actor type inferred from an authenticated user's roles for audit writes. */
export function actorTypeFromRoles(roles: AppRole[]): 'member' | 'supervisor' | 'admin' {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('supervisor')) return 'supervisor';
  return 'member';
}

export const auditService = {
  async write(params: WriteAuditParams): Promise<void> {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      actor_type: params.actorType,
      actor_id: params.actorId ?? null,
      action: params.action,
      entry_id: params.entryId ?? null,
      detail: params.detail,
    });

    if (error) {
      // Per spec: never throw — audit failures must not break the calling flow.
      logger.error('auditService.write failed', { error, params });
    }
  },
};
