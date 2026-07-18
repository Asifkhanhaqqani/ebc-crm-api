import { supabaseAdmin } from '../config';
import { logger } from '../logger';
import { dutyLedgerService } from '../services/dutyLedgerService';
import { auditService } from '../services/auditService';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Runs the same generation dutyLedgerService.generateForDate() does for a
 * manual "Generate Ledger" click, but only when Settings > Duty Board Config
 * has "Auto-generate duty ledger" switched on — gated the same way
 * shiftPacketEmail.ts gates on X-Cron-Secret, so an external scheduler
 * (Railway cron) can hit this safely every day at shift_start_time without
 * generating duplicate rows (generateForDate upserts with ignoreDuplicates).
 */
export async function runGenerateDutyLedgerJob(): Promise<{ ran: boolean; count: number }> {
  const { data: setting, error } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'auto_generate_duty_ledger')
    .maybeSingle();

  if (error) {
    logger.error('generateDutyLedger: failed to read auto_generate_duty_ledger setting', { error });
    throw error;
  }

  if (setting?.value !== 'true') {
    logger.info('generateDutyLedger: auto-generate is OFF, skipping');
    return { ran: false, count: 0 };
  }

  const shiftDate = todayIso();
  const rows = await dutyLedgerService.generateForDate(shiftDate);

  await auditService.write({
    actorType: 'system',
    action: 'duty_ledger.auto_generate',
    entryId: shiftDate,
    detail: `Auto-generated ${rows.length} duty ledger rows for ${shiftDate}`,
  });

  return { ran: true, count: rows.length };
}
