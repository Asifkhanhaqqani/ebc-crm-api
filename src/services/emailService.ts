import { Resend } from 'resend';
import { config, supabaseAdmin } from '../config';
import { logger } from '../logger';
import { assertNoDbError } from '../utils/db';

const MAX_ATTEMPTS = 3;
const FLUSH_DELAY_MS = 30 * 1000;

const resend = new Resend(config.RESEND_API_KEY || 'disabled');

interface QueueEmailParams {
  triggerEvent: string;
  entryId?: string;
  recipientIds: string[];
  subject: string;
  bodyHtml: string;
}

export const emailService = {
  /** Inserts into notifications_outbox. Does NOT send — see flushOutbox(). */
  async queueEmail(params: QueueEmailParams): Promise<void> {
    const { error } = await supabaseAdmin.from('notifications_outbox').insert({
      trigger_event: params.triggerEvent,
      entry_id: params.entryId ?? null,
      recipient_ids: params.recipientIds,
      subject: params.subject,
      body_html: params.bodyHtml,
    });
    assertNoDbError(error, 'emailService.queueEmail');
  },

  /**
   * Sends all outbox rows not yet sent. `sent_at IS NULL` is checked before
   * sending, so calling this twice (e.g. cron + shift-close trigger) never
   * results in a duplicate send for the same row.
   */
  async flushOutbox(): Promise<void> {
    const cutoff = new Date(Date.now() - FLUSH_DELAY_MS).toISOString();

    const { data: pending, error } = await supabaseAdmin
      .from('notifications_outbox')
      .select('*')
      .is('sent_at', null)
      .lt('queued_at', cutoff)
      .lt('attempt_count', MAX_ATTEMPTS);
    assertNoDbError(error, 'emailService.flushOutbox fetch');

    for (const row of pending ?? []) {
      try {
        const recipientEmails = await resolveRecipientEmails(row.recipient_ids);
        if (recipientEmails.length === 0) {
          throw new Error('No resolvable recipient emails');
        }

        if (config.RESEND_API_KEY) {
          await resend.emails.send({
            from: config.FROM_EMAIL,
            to: recipientEmails,
            subject: row.subject,
            html: row.body_html,
          });
        } else {
          logger.warn('RESEND_API_KEY not set — skipping actual send', { id: row.id });
        }

        const { error: markSentError } = await supabaseAdmin
          .from('notifications_outbox')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', row.id)
          .is('sent_at', null);
        assertNoDbError(markSentError, 'flushOutbox mark sent');
      } catch (err) {
        logger.error('flushOutbox send failed', { id: row.id, err });
        await supabaseAdmin
          .from('notifications_outbox')
          .update({
            attempt_count: (row.attempt_count ?? 0) + 1,
            error_message: err instanceof Error ? err.message : String(err),
          })
          .eq('id', row.id);
      }
    }
  },
};

async function resolveRecipientEmails(employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('email')
    .in('id', employeeIds)
    .not('email', 'is', null);
  assertNoDbError(error, 'resolveRecipientEmails');
  return (data ?? []).map((r) => r.email as string).filter(Boolean);
}
