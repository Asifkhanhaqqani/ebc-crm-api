-- ============================================================================
-- EBC/JPFD Workforce CRM — Database Schema
-- Run this file first in the Supabase SQL Editor, then triggers.sql,
-- then rls_policies.sql.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ============================================================================
-- 1. companies  (created before employees — employees.company_code references it)
-- ============================================================================
create table companies (
  code             text primary key,
  station          text not null,
  district         integer,
  suffix_rule      text,
  records_only     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- 2. employees
-- ============================================================================
create table employees (
  id               uuid primary key default gen_random_uuid(),
  emp_number       integer unique not null,
  last_name        text not null,
  first_name       text not null,
  middle_initial   char(1),
  rank             text not null check (rank in ('DC','Sub-DC','Capt','Sub-CAPT','LT','Sub-LT','OP','FF')),
  platoon          char(1) not null check (platoon in ('A','B','C')),
  company_code     text not null references companies(code),
  station_override text,
  dc_initial       char(2),
  supervisor       boolean not null default false,
  status           text not null default 'Active' check (status in ('Active','Inactive')),
  email            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_employees_platoon on employees (platoon);
create index idx_employees_company_code on employees (company_code);
create index idx_employees_status on employees (status);

-- ============================================================================
-- 3. rotation_schedule
-- ============================================================================
create table rotation_schedule (
  id               uuid primary key default gen_random_uuid(),
  shift_date       date unique not null,
  platoon          char(1) not null check (platoon in ('A','B','C')),
  pp_start         date not null,
  pp_end           date not null,
  created_at       timestamptz not null default now()
);

create index idx_rotation_schedule_pp_end on rotation_schedule (pp_end);

-- ============================================================================
-- 4. duty_ledger
-- ============================================================================
create table duty_ledger (
  id               uuid primary key default gen_random_uuid(),
  shift_date       date not null,
  platoon          char(1) not null,
  employee_id      uuid not null references employees(id),
  company_code     text not null references companies(code),
  station          text not null,
  duty_status      text not null check (duty_status in ('O','AL','SL','EAL','ISSL','FODI','ADM','AWOL','FL','CT','CL','DET','MWA','OWD')),
  acting_note      text,
  shift_start      time not null default '07:00',
  shift_end        time not null default '07:00',
  hours_worked     numeric(5,2) not null default 24.00,
  is_closed        boolean not null default false,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (shift_date, employee_id)
);

create index idx_duty_ledger_open on duty_ledger (shift_date) where is_closed = false;
create index idx_duty_ledger_employee on duty_ledger (employee_id);

-- ============================================================================
-- 5. leave_records
-- ============================================================================
create table leave_records (
  id               uuid primary key default gen_random_uuid(),
  entry_id         text unique not null,
  employee_id      uuid not null references employees(id),
  leave_type       text not null check (leave_type in ('AL','EAL','SL','ISSL','FODI','ADM','AWOL','FL','CT','CL','DET','MWA')),
  shift_date       date not null,
  span_start       time not null,
  span_end         time not null,
  reason           text,
  status           text not null default 'PendingApproval'
                     check (status in ('PendingApproval','Granted','Active','Waitlist','Promoted','Cancelled','Deleted')),
  parent_id        uuid references leave_records(id),
  submitted_at     timestamptz not null default now(),
  supervisor_id    uuid references employees(id),
  capt_signed_at   timestamptz,
  dc_signed_at     timestamptz,
  sl_illness       boolean default false,
  sl_medical       boolean default false,
  sl_dental        boolean default false,
  sl_optical       boolean default false,
  sl_death         boolean default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_leave_records_employee on leave_records (employee_id);
create index idx_leave_records_shift_date on leave_records (shift_date);

-- ============================================================================
-- 6. al_slot_ledger
-- ============================================================================
create table al_slot_ledger (
  id               uuid primary key default gen_random_uuid(),
  platoon          char(1) not null,
  shift_date       date not null,
  peak_concurrent  integer not null default 0,
  max_slots        integer not null default 12,
  last_rebuilt_at  timestamptz not null default now(),
  unique (platoon, shift_date)
);

-- ============================================================================
-- 7. mwa_records  (Mutual/Working Aid records)
-- ============================================================================
create table mwa_records (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id),
  shift_date       date not null,
  agency           text not null,
  span_start       time not null,
  span_end         time not null,
  reason           text,
  status           text not null default 'PendingApproval' check (status in ('PendingApproval','Approved','Denied','Cancelled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- 8. det_records  (Detail records)
-- ============================================================================
create table det_records (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id),
  shift_date       date not null,
  detail_location  text not null,
  span_start       time not null,
  span_end         time not null,
  reason           text,
  status           text not null default 'PendingApproval' check (status in ('PendingApproval','Approved','Denied','Cancelled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- 9. ot_availability
-- ============================================================================
create table ot_availability (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id),
  available_from    date not null,
  available_through date not null,
  target_platoon    char(1) check (target_platoon in ('A','B','C')),
  ot_type           text not null default 'General',
  excluded_dates    date[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_ot_availability_employee on ot_availability (employee_id);

-- ============================================================================
-- 10. ot_requests
-- ============================================================================
create table ot_requests (
  id               uuid primary key default gen_random_uuid(),
  shift_date       date not null,
  company_code     text references companies(code),
  rank_group       text not null,
  status           text not null default 'Open' check (status in ('Open','Offered','Filled','Cancelled','Expired')),
  filled_by        uuid references employees(id),
  ladder_stage     text check (ladder_stage in ('T-24h','T-12h','T-1h','T-15m','Filled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_ot_requests_shift_date on ot_requests (shift_date);

-- ============================================================================
-- 11. payroll_rows
-- ============================================================================
create table payroll_rows (
  id                uuid primary key default gen_random_uuid(),
  shift_date        date not null,
  employee_id       uuid not null references employees(id),
  company_code      text not null,
  station           text not null,
  platoon           char(1) not null,
  hours_worked      numeric(5,2) not null,
  acting_note       text,
  acting_hours      numeric(5,2) not null default 0,
  leave_type        text,
  leave_hours_used  numeric(5,2) not null default 0,
  leave_span_start  time,
  leave_span_end    time,
  district          integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (shift_date, employee_id, leave_type)
);

create index idx_payroll_rows_date_district on payroll_rows (shift_date, district);

-- ============================================================================
-- 12. timesheet_segments
-- ============================================================================
create table timesheet_segments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id),
  pp_end           date not null,
  shift_date       date not null,
  segment_type     text not null check (segment_type in ('work','leave')),
  date_in          date,
  date_out         date,
  time_in          time,
  time_out         time,
  leave_start_date date,
  leave_end_date   date,
  leave_time_in    time,
  leave_time_out   time,
  hours            numeric(5,2) not null,
  leave_type       text,
  created_at       timestamptz not null default now()
);

create index idx_timesheet_segments_employee_pp on timesheet_segments (employee_id, pp_end);

-- ============================================================================
-- 13. shift_close
-- ============================================================================
create table shift_close (
  id                uuid primary key default gen_random_uuid(),
  shift_date        date not null,
  station            text not null,
  platoon           char(1) not null,
  supervisor_id     uuid not null references employees(id),
  signed_at         timestamptz not null default now(),
  packet_sent_at    timestamptz,
  correction_count  integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (shift_date, station)
);

-- ============================================================================
-- 14. audit_log  (immutable — enforced by trigger in triggers.sql)
-- ============================================================================
create table audit_log (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  actor_type       text not null check (actor_type in ('member','supervisor','admin','system')),
  actor_id         uuid references employees(id),
  action           text not null,
  entry_id         text,
  detail           text
);

create index idx_audit_log_occurred_at on audit_log (occurred_at desc);

-- ============================================================================
-- 15. notifications_outbox
-- ============================================================================
create table notifications_outbox (
  id               uuid primary key default gen_random_uuid(),
  trigger_event    text not null,
  entry_id         text,
  recipient_ids    uuid[] not null,
  subject          text not null,
  body_html        text not null,
  queued_at        timestamptz not null default now(),
  sent_at          timestamptz,
  attempt_count    integer not null default 0,
  error_message    text,
  created_at       timestamptz not null default now()
);

create index idx_notifications_outbox_unsent on notifications_outbox (queued_at) where sent_at is null;

-- ============================================================================
-- 16. roles
-- ============================================================================
create table roles (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id),
  role             text not null check (role in ('admin','supervisor','member')),
  assigned_at      timestamptz not null default now(),
  assigned_by      uuid references employees(id),
  unique (employee_id, role)
);

-- ============================================================================
-- 17. settings
-- ============================================================================
create table settings (
  key              text primary key,
  value            text not null,
  description      text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references employees(id)
);

-- ============================================================================
-- Partial indexes required by spec
-- ============================================================================
create index idx_leave_records_open on leave_records (shift_date, employee_id)
  where status in ('Granted','Active','Waitlist');
create index idx_duty_ledger_not_closed on duty_ledger (shift_date) where is_closed = false;
create index idx_payroll_rows_shift_district on payroll_rows (shift_date, district);
create index idx_audit_log_recent on audit_log (occurred_at desc);

-- ============================================================================
-- 18. ot_tier_board  (materialized view)
-- ============================================================================
create materialized view ot_tier_board as
  select
    e.id as employee_id,
    e.last_name || ', ' || e.first_name as full_name,
    e.rank,
    e.platoon,
    coalesce(
      extract(day from now() - max(pr.shift_date::timestamptz))::integer,
      9999
    ) as days_since_ot,
    max(pr.shift_date) as last_ot_date
  from employees e
  left join payroll_rows pr on pr.employee_id = e.id and pr.acting_note like '%OT%'
  where e.status = 'Active'
  group by e.id, e.rank, e.platoon
  order by days_since_ot desc;

create unique index on ot_tier_board (employee_id);

-- ============================================================================
-- Seed data
-- ============================================================================

-- Companies
insert into companies (code, station, district, suffix_rule, records_only) values
  ('E208', 'Station 8',  120, '8 · Capt+OP+2',  false),
  ('L177', 'Station 7',  140, '7 · LT+OP+FF',   false),
  ('S169', 'Station 9',  160, '9 · Capt+OP+2',  false),
  ('C160', 'Station 6',  160, '6 · DC+2',       false),
  ('E138', 'Station 3',  120, '8 · Capt+OP+2',  false),
  ('E168', 'Station 6',  160, '8 · Capt+OP+2',  false),
  ('E178', 'Station 7',  140, '8 · Capt+OP+2',  false),
  ('C140', 'Station 4',  140, '6 · DC+2',       false),
  ('E128', 'Station 2',  120, '8 · Capt+OP+2',  false),
  ('C102', 'HQ',         null,'6 · DC+2',       true);

-- Employees (12 EBC/JPFD personnel)
insert into employees (emp_number, last_name, first_name, rank, platoon, company_code, supervisor, status) values
  (1001, 'Burkett',     'Craig',    'DC',       'A', 'C102', true,  'Active'),
  (1002, 'Landry',      'Thomas',   'Capt',     'A', 'E208', true,  'Active'),
  (1003, 'Guidry',      'Marc',     'OP',       'A', 'E208', false, 'Active'),
  (1004, 'Delacroix',   'Jonah',    'FF',       'B', 'L177', false, 'Active'),
  (1005, 'Melancon',    'Rene',     'Sub-CAPT', 'B', 'L177', false, 'Active'),
  (1006, 'Fontenot',    'Terrence', 'Capt',     'B', 'S169', true,  'Active'),
  (1007, 'Broussard',   'Elise',    'FF',       'C', 'S169', false, 'Active'),
  (1008, 'Thibodeaux',  'Karl',     'LT',       'C', 'C160', true,  'Active'),
  (1009, 'Babineaux',   'Ana',      'FF',       'C', 'C160', false, 'Active'),
  (1010, 'Cormier',     'Dana',     'Sub-DC',   'A', 'C102', false, 'Active'),
  (1011, 'Prejean',     'Omar',     'Sub-LT',   'B', 'E138', false, 'Active'),
  (1012, 'Robichaux',   'Gil',      'OP',       'C', 'E168', false, 'Active');

-- Rotation schedule 2026-07-01 through 2026-12-31
-- Anchor: 2026-01-01 = Platoon B. Cycle repeats A,B,C every shift (1 day per shift).
-- Pay periods are 14-day blocks anchored to 2026-01-01 (pp_start) with pp_end = pp_start+13.
do $$
declare
  d date := '2026-07-01';
  anchor date := '2026-01-01';
  cycle_pos integer;
  plt char(1);
  pp_anchor date := '2026-01-01';
  days_since_pp_anchor integer;
  pp_start_d date;
  pp_end_d date;
begin
  while d <= '2026-12-31' loop
    -- platoon cycle: (days since anchor) mod 3 -> 0=B,1=C,2=A  (anchor date itself = B)
    cycle_pos := ((d - anchor) % 3 + 3) % 3;
    plt := case cycle_pos when 0 then 'B' when 1 then 'C' else 'A' end;

    days_since_pp_anchor := d - pp_anchor;
    pp_start_d := pp_anchor + (floor(days_since_pp_anchor / 14.0)::integer * 14);
    pp_end_d := pp_start_d + 13;

    insert into rotation_schedule (shift_date, platoon, pp_start, pp_end)
    values (d, plt, pp_start_d, pp_end_d)
    on conflict (shift_date) do nothing;

    d := d + 1;
  end loop;
end $$;

-- Leave records (5, one per required status)
insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV1720902-338-1', id, 'AL', '2026-07-21', '07:00', '19:00', 'Family event', 'Granted', now() - interval '5 days'
from employees where emp_number = 1004;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV1720902-338-2', id, 'SL', '2026-07-22', '07:00', '19:00', 'Illness', 'PendingApproval', now() - interval '2 days'
from employees where emp_number = 1007;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV1720902-338-3', id, 'AL', '2026-07-21', '07:00', '19:00', 'Vacation', 'Waitlist', now() - interval '1 day'
from employees where emp_number = 1009;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV1720902-338-4', id, 'AL', '2026-07-25', '07:00', '19:00', 'Personal', 'Promoted', now() - interval '3 days'
from employees where emp_number = 1011;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV1720902-338-5', id, 'FL', '2026-07-28', '07:00', '19:00', 'Funeral', 'Deleted', now() - interval '4 days'
from employees where emp_number = 1012;

-- Settings
insert into settings (key, value, description) values
  ('max_al_slots_per_shift', '12',        'Maximum concurrent AL slots allowed per platoon per shift'),
  ('shift_start_time',       '07:00',     'Standard shift start time (24h)'),
  ('timezone',               'America/Chicago', 'Application timezone for all shift date logic'),
  ('packet_email_time',      '08:15',     'Local time the shift-packet cron job runs'),
  ('admin_email',            'admin@ebc-fire.org', 'Fallback recipient for admin notifications');
