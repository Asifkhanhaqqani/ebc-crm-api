import { describe, expect, it } from 'vitest';
import {
  clampedSpanHours,
  computeDaySegments,
  earnsNormalWorkCredit,
  isCountedForStaffing,
  payPeriodEndBoundaryFor,
  payPeriodEndKeyFor,
  payPeriodStartFor,
} from '../../src/services/shiftMath';
import { RANK_SENIORITY, DutyStatus } from '../../src/types';

// ---------------------------------------------------------------------------
// TASK 1 — Train duty status
// ---------------------------------------------------------------------------

describe('Train duty status', () => {
  it('excludes Train from on-duty / minimum-staffing counts (station can go short)', () => {
    expect(isCountedForStaffing('O')).toBe(true);
    expect(isCountedForStaffing('Train')).toBe(false);
    for (const status of ['AL', 'SL', 'ISSL', 'DET', 'MWA', 'FODI'] as DutyStatus[]) {
      expect(isCountedForStaffing(status)).toBe(false);
    }
  });

  it('gives a Train day normal work credit — identical to a plain O day', () => {
    expect(earnsNormalWorkCredit('O')).toBe(true);
    expect(earnsNormalWorkCredit('Train')).toBe(true);
    expect(earnsNormalWorkCredit('AL')).toBe(false);

    // Timesheet/payroll segment math never branches on duty_status, so a Train
    // day and an O day with the same inputs produce byte-identical segments.
    const oDay = computeDaySegments('emp-1', '2026-06-12', '2026-06-01', []);
    const trainDay = computeDaySegments('emp-1', '2026-06-12', '2026-06-01', []);
    expect(trainDay).toEqual(oDay);

    // Full 24 hours of work credit, no leave segment, nothing resembling leave.
    expect(trainDay).toHaveLength(1);
    expect(trainDay[0].segment_type).toBe('work');
    expect(trainDay[0].hours).toBe(24);
    expect(trainDay[0].leave_type).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TASK 2 — complete rank list
// ---------------------------------------------------------------------------

describe('rank seniority', () => {
  it('contains exactly the 12 required ranks in seniority order', () => {
    expect(RANK_SENIORITY).toEqual([
      'AC', 'Sub-AC', 'DC', 'Sub-DC', 'Capt', 'Sub-CAPT',
      'LT', 'Sub-LT', 'OP', 'Sub-OP', 'FF', 'Sub-FF',
    ]);
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — pay periods are retroactive
// ---------------------------------------------------------------------------

describe('pay period boundaries (anchor: Saturday 2026-05-30 07:00, 14-day periods)', () => {
  it('every shift date in the period ending 2026-06-13 lies before that boundary', () => {
    // The period the client calls "ending 6/13" covers shift dates
    // 2026-05-30 .. 2026-06-12; the 06-12 shift ends exactly at the
    // 2026-06-13 07:00 boundary. rotation_schedule keys it as pp_end 2026-06-12.
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(Date.UTC(2026, 4, 30 + i)).toISOString().slice(0, 10);
      expect(payPeriodStartFor(d)).toBe('2026-05-30');
      expect(payPeriodEndBoundaryFor(d)).toBe('2026-06-13');
      expect(payPeriodEndKeyFor(d)).toBe('2026-06-12');
    }
  });

  it('a shift dated on the boundary Saturday belongs entirely to the NEXT period', () => {
    expect(payPeriodStartFor('2026-06-13')).toBe('2026-06-13');
    expect(payPeriodEndBoundaryFor('2026-06-13')).toBe('2026-06-27');
  });

  it("matches the client's 2024 example: 11/2 period covers 10/19 → 11/2, never after", () => {
    // Pay period ending 11/2/2024 covers 10/19/2024 07:00 → 11/2/2024 07:00.
    expect(payPeriodStartFor('2024-10-19')).toBe('2024-10-19');
    expect(payPeriodEndBoundaryFor('2024-10-19')).toBe('2024-11-02');
    expect(payPeriodEndBoundaryFor('2024-11-01')).toBe('2024-11-02');

    // Shifts worked 11/4–11/12 belong to the 11/16 period, NOT 11/2.
    for (const d of ['2024-11-04', '2024-11-06', '2024-11-08', '2024-11-10', '2024-11-12']) {
      expect(payPeriodEndBoundaryFor(d)).toBe('2024-11-16');
    }
  });

  it('splits a span crossing the 07:00 cutoff: hours before → old period, after → excluded', () => {
    // Leave recorded 23:00 → 09:00 on 2026-06-12, the last shift of the period
    // ending 2026-06-13 07:00. Only 23:00 → 07:00 (8h) belongs to this period;
    // the 07:00 → 09:00 remainder (2h) is clamped out and must be recorded on
    // the 2026-06-13 shift, which belongs to the next period.
    const segments = computeDaySegments('emp-1', '2026-06-12', '2026-06-12', [
      { span_start: '23:00', span_end: '09:00', leave_type: 'SL' },
    ]);

    expect(segments).toHaveLength(2);

    const [work, leave] = segments;
    expect(work.segment_type).toBe('work');
    expect(work.time_in).toBe('07:00');
    expect(work.time_out).toBe('23:00');
    expect(work.hours).toBe(16);

    expect(leave.segment_type).toBe('leave');
    expect(leave.leave_time_in).toBe('23:00');
    expect(leave.leave_time_out).toBe('07:00'); // clamped at the boundary, not 09:00
    expect(leave.leave_end_date).toBe('2026-06-13');
    expect(leave.hours).toBe(8);

    // The day still accounts for exactly 24 hours — nothing crosses the boundary.
    const total = segments.reduce((sum, s) => sum + s.hours, 0);
    expect(total).toBe(24);

    // Payroll sees the same clamp: leave_hours_used is 8, not 10.
    expect(clampedSpanHours({ span_start: '23:00', span_end: '09:00' })).toBe(8);
  });

  it('keeps ordinary in-window spans untouched', () => {
    const segments = computeDaySegments('emp-1', '2026-06-12', '2026-06-05', [
      { span_start: '07:00', span_end: '19:00', leave_type: 'AL' },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0].segment_type).toBe('leave');
    expect(segments[0].hours).toBe(12);
    expect(segments[1].segment_type).toBe('work');
    expect(segments[1].hours).toBe(12);
  });

  it('anchors early-morning spans to the overnight half of the shift', () => {
    // 03:00–06:00 belongs to the back half of the previous 07:00 shift.
    const segments = computeDaySegments('emp-1', '2026-06-12', '2026-06-05', [
      { span_start: '03:00', span_end: '06:00', leave_type: 'SL' },
    ]);
    const leave = segments.find((s) => s.segment_type === 'leave')!;
    expect(leave.leave_time_in).toBe('03:00');
    expect(leave.leave_time_out).toBe('06:00');
    expect(leave.leave_start_date).toBe('2026-06-05');
    expect(leave.leave_end_date).toBe('2026-06-06');
    expect(leave.hours).toBe(3);
    const total = segments.reduce((sum, s) => sum + s.hours, 0);
    expect(total).toBe(24);
  });
});
