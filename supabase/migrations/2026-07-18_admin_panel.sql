-- ============================================================================
-- Admin configuration panel: notification rules table + supporting settings.
--
-- notification_rules backs the Settings > Notifications tab's rule table —
-- previously that table was described only in application code with no real
-- persistence, which would have made its "Edit" action a dead button. This
-- gives it a real, admin-editable backing store instead.
--
-- from_email and auto_generate_duty_ledger extend the existing generic
-- settings key/value store (see supabase/schema.sql section 17) with two new
-- rows — safe to run multiple times.
-- Run in the Supabase SQL Editor against the live project.
-- ============================================================================

create table if not exists notification_rules (
  event        text primary key,
  enabled      boolean not null default true,
  recipients   text not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references employees(id)
);

insert into notification_rules (event, enabled, recipients, description) values
  ('leave.submitted',   true, 'Supervisor',       'Sent when a member submits a leave request'),
  ('leave.approved',    true, 'Member + DC',       'Sent when a leave request is granted'),
  ('shift.packet',      true, 'District Chiefs',   'Daily shift packet PDF, sent at the scheduled packet time'),
  ('overtime.offer',    true, 'Tier members',      'Sent when an OT slot is offered down the tier ladder'),
  ('staffing.low',      true, 'On-duty DC',        'Sent when a station falls below required staffing')
on conflict (event) do nothing;

insert into settings (key, value, description) values
  ('from_email', 'crm@ebc-fire.org', 'Sender address for outbound notification emails (Resend "from")'),
  ('auto_generate_duty_ledger', 'false', 'When true, the generate-duty-ledger cron job runs automatically at shift_start_time')
on conflict (key) do nothing;
