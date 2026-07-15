import { config, supabaseAdmin } from '../config';
import { logger } from '../logger';
import { pdfService } from '../services/pdfService';
import { emailService } from '../services/emailService';
import { auditService } from '../services/auditService';

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Verifies the X-Cron-Secret header when this job is invoked over HTTP. */
export function verifyCronSecret(headerValue: string | undefined): boolean {
  return Boolean(config.CRON_SECRET) && headerValue === config.CRON_SECRET;
}

export async function runShiftPacketEmailJob(): Promise<void> {
  const shiftDate = yesterdayIso();

  const { data: closures, error } = await supabaseAdmin
    .from('shift_close')
    .select('*')
    .eq('shift_date', shiftDate)
    .is('packet_sent_at', null);

  if (error) {
    logger.error('shiftPacketEmail: failed to fetch shift_close rows', { error });
    throw error;
  }

  for (const closure of closures ?? []) {
    try {
      const { data: dutyRow } = await supabaseAdmin
        .from('duty_ledger')
        .select('employee_id, company_code, companies!inner(district)')
        .eq('shift_date', shiftDate)
        .eq('station', closure.station)
        .limit(1)
        .maybeSingle();

      const district = (dutyRow as any)?.companies?.district;
      const url = district
        ? await pdfService.generatePayrollPdf(shiftDate, district)
        : null;

      const { data: dcs } = await supabaseAdmin.from('employees').select('id').eq('rank', 'DC');

      await emailService.queueEmail({
        triggerEvent: 'shift.packet',
        entryId: closure.id,
        recipientIds: (dcs ?? []).map((d) => d.id),
        subject: `Shift packet — ${closure.station} · ${shiftDate}`,
        bodyHtml: url
          ? `<p>Shift packet for ${closure.station} on ${shiftDate} is ready: <a href="${url}">${url}</a></p>`
          : `<p>Shift packet for ${closure.station} on ${shiftDate}.</p>`,
      });
      await emailService.flushOutbox();

      await supabaseAdmin
        .from('shift_close')
        .update({ packet_sent_at: new Date().toISOString() })
        .eq('id', closure.id);

      await auditService.write({
        actorType: 'system',
        action: 'shift.packet.sent',
        entryId: closure.id,
        detail: `Packet emailed for ${closure.station} · ${shiftDate}`,
      });
    } catch (err) {
      logger.error('shiftPacketEmail: failed for station', { station: closure.station, err });
    }
  }
}

if (require.main === module) {
  runShiftPacketEmailJob()
    .then(() => {
      logger.info('shiftPacketEmail job completed');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('shiftPacketEmail job failed', { err });
      process.exit(1);
    });
}
