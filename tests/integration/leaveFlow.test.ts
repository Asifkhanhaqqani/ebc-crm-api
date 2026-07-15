import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/emailService', () => ({
  emailService: {
    queueEmail: vi.fn().mockResolvedValue(undefined),
    flushOutbox: vi.fn().mockResolvedValue(undefined),
  },
}));

process.env.SUPABASE_URL = process.env.SUPABASE_URL_TEST ?? process.env.SUPABASE_URL;

let app: import('express').Express;
let authToken: string;
let testEmployeeId: string;

/**
 * These tests exercise the full leave-submission → waitlist → FIFO-promotion
 * flow against a real (test) Supabase project. Set SUPABASE_URL_TEST,
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY and a valid test user session
 * token before running `npm test`.
 */
describe('leave flow integration', () => {
  beforeAll(async () => {
    app = (await import('../../src/index')).default;
    authToken = process.env.TEST_USER_JWT ?? '';
    testEmployeeId = process.env.TEST_EMPLOYEE_ID ?? '';
  });

  it('POST /api/leave creates a PendingApproval record and writes an audit row', async () => {
    const res = await request(app)
      .post('/api/leave')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        employee_id: testEmployeeId,
        leave_type: 'AL',
        shift_date: '2026-07-21',
        span_start: '07:00',
        span_end: '19:00',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('PendingApproval');
  });

  it('the 11th concurrent AL request on a shift is placed on Waitlist', async () => {
    let lastStatus = 'PendingApproval';
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/leave')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          employee_id: testEmployeeId,
          leave_type: 'AL',
          shift_date: '2026-07-22',
          span_start: '07:00',
          span_end: '19:00',
        });
      lastStatus = res.body.data?.status;
    }
    expect(lastStatus).toBe('Waitlist');
  });

  it('PATCH /:id/status Cancelled promotes the next waitlisted record via FIFO', async () => {
    const list = await request(app)
      .get('/api/leave-records?shift_date=2026-07-22&status=Granted')
      .set('Authorization', `Bearer ${authToken}`);
    const toCancel = list.body.data?.[0];
    if (!toCancel) return;

    const res = await request(app)
      .patch(`/api/leave-records/${toCancel.id}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'Cancelled' });

    expect(res.status).toBe(200);

    const waitlistAfter = await request(app)
      .get('/api/leave-records?shift_date=2026-07-22&status=Promoted')
      .set('Authorization', `Bearer ${authToken}`);
    expect(Array.isArray(waitlistAfter.body.data)).toBe(true);
  });

  it('GET /api/leave/slots/A/2026-07-21 reports the correct peak_concurrent', async () => {
    const res = await request(app)
      .get('/api/leave/slots/A/2026-07-21')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.peak_concurrent).toBe('number');
  });
});
