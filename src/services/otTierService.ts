import { supabaseAdmin } from '../config';
import { assertNoDbError } from '../utils/db';
import { OtTierBoardRow, Rank } from '../types';
import { emailService } from './emailService';
import { rotationService } from './rotationService';

const RANK_GROUPS: Record<string, Rank[]> = {
  ac: ['AC', 'Sub-AC'],
  dc: ['DC', 'Sub-DC'],
  capt: ['Capt', 'Sub-CAPT'],
  lt: ['LT', 'Sub-LT'],
  op: ['OP', 'Sub-OP'],
  ff: ['FF', 'Sub-FF'],
};

const LADDER_STAGES: Array<{ stage: 'T-24h' | 'T-12h' | 'T-1h' | 'T-15m'; label: string }> = [
  { stage: 'T-24h', label: 'Initial offer — 24 hours before shift' },
  { stage: 'T-12h', label: 'Escalation — 12 hours before shift' },
  { stage: 'T-1h', label: 'Final call — 1 hour before shift' },
  { stage: 'T-15m', label: 'DC notification — 15 minutes before shift' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const otTierService = {
  async getTierBoard(rankGroup: string): Promise<OtTierBoardRow[]> {
    const ranks = RANK_GROUPS[rankGroup.toLowerCase()];
    if (!ranks) {
      return [];
    }

    // Best-effort refresh — if it fails the view is simply slightly stale.
    try {
      await supabaseAdmin.rpc('refresh_ot_tier_board');
    } catch {
      // ignore — stale view is acceptable
    }

    let onDutyPlatoon: string | null = null;
    try {
      const rotation = await rotationService.getRotationForDate(todayIso());
      onDutyPlatoon = rotation.platoon;
    } catch {
      onDutyPlatoon = null;
    }

    const { data, error } = await supabaseAdmin
      .from('ot_tier_board')
      .select('*')
      .in('rank', ranks)
      .order('days_since_ot', { ascending: false });
    assertNoDbError(error, 'getTierBoard');

    const rows = (data ?? []) as OtTierBoardRow[];
    return onDutyPlatoon ? rows.filter((r) => r.platoon !== onDutyPlatoon) : rows;
  },

  /** Implements the T-24h / T-12h / T-1h / T-15m notification ladder for one OT request. */
  async sendOtOffers(otRequestId: string): Promise<void> {
    const { data: request, error } = await supabaseAdmin
      .from('ot_requests')
      .select('*')
      .eq('id', otRequestId)
      .single();
    assertNoDbError(error, 'sendOtOffers fetch request');

    const rankGroup = (request as any).rank_group as string;
    const tier = await this.getTierBoard(rankGroup);

    const { data: availability, error: availError } = await supabaseAdmin
      .from('ot_availability')
      .select('employee_id')
      .lte('available_from', request.shift_date)
      .gte('available_through', request.shift_date);
    assertNoDbError(availError, 'sendOtOffers fetch availability');

    const availableIds = new Set((availability ?? []).map((a) => a.employee_id));
    const eligible = tier.filter((row) => availableIds.has(row.employee_id));

    const currentStage = LADDER_STAGES.find((s) => s.stage === request.ladder_stage) ?? LADDER_STAGES[0];
    const recipients = currentStage.stage === 'T-15m' ? [] : eligible.map((e) => e.employee_id);

    if (recipients.length > 0) {
      await emailService.queueEmail({
        triggerEvent: `ot.offer.${currentStage.stage}`,
        entryId: otRequestId,
        recipientIds: recipients,
        subject: `Overtime opportunity — ${request.shift_date} (${currentStage.label})`,
        bodyHtml: `<p>An overtime slot is open for ${request.shift_date}. ${currentStage.label}.</p>`,
      });
    }

    if (currentStage.stage === 'T-15m') {
      const { data: dcs } = await supabaseAdmin.from('employees').select('id').eq('rank', 'DC');
      await emailService.queueEmail({
        triggerEvent: 'ot.offer.dc_notification',
        entryId: otRequestId,
        recipientIds: (dcs ?? []).map((d) => d.id),
        subject: `OT slot unfilled — ${request.shift_date}`,
        bodyHtml: `<p>Overtime slot for ${request.shift_date} remains unfilled at T-15m.</p>`,
      });
    }

    await supabaseAdmin
      .from('ot_requests')
      .update({ ladder_stage: currentStage.stage })
      .eq('id', otRequestId);
  },
};
