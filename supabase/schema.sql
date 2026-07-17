-- ============================================================================
-- EBC/JPFD Workforce CRM — Database Schema
-- Run this file first in the Supabase SQL Editor, then triggers.sql,
-- then rls_policies.sql.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists btree_gist; -- for the det_records overlap exclusion constraint

-- ============================================================================
-- 1. companies  (created before employees — employees.company_code references it)
-- ============================================================================
create table if not exists companies (
  code             text primary key,
  station          text not null,
  district         integer,
  suffix_rule      text,
  records_only     boolean not null default false,
  station_override text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- 2. employees
-- ============================================================================
create table if not exists employees (
  id               uuid primary key default gen_random_uuid(),
  emp_number       integer unique not null,
  last_name        text not null,
  first_name       text not null,
  middle_initial   char(1),
  rank             text not null check (rank in ('AC','Sub-AC','DC','Sub-DC','Capt','Sub-CAPT','LT','Sub-LT','OP','Sub-OP','FF','Sub-FF')),
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

create index if not exists idx_employees_platoon on employees (platoon);
create index if not exists idx_employees_company_code on employees (company_code);
create index if not exists idx_employees_status on employees (status);

-- ============================================================================
-- 3. rotation_schedule
-- ============================================================================
create table if not exists rotation_schedule (
  id               uuid primary key default gen_random_uuid(),
  shift_date       date unique not null,
  platoon          char(1) not null check (platoon in ('A','B','C')),
  pp_start         date not null,
  pp_end           date not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_rotation_schedule_pp_end on rotation_schedule (pp_end);

-- ============================================================================
-- 4. duty_ledger
-- ============================================================================
create table if not exists duty_ledger (
  id               uuid primary key default gen_random_uuid(),
  shift_date       date not null,
  platoon          char(1) not null,
  employee_id      uuid not null references employees(id),
  company_code     text not null references companies(code),
  station          text not null,
  duty_status      text not null check (duty_status in ('O','Train','AL','SL','EAL','ISSL','FODI','ADM','AWOL','FL','CT','CL','DET','MWA','OWD')),
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

create index if not exists idx_duty_ledger_open on duty_ledger (shift_date) where is_closed = false;
create index if not exists idx_duty_ledger_employee on duty_ledger (employee_id);

-- ============================================================================
-- 5. leave_records
-- ============================================================================
create table if not exists leave_records (
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

create index if not exists idx_leave_records_employee on leave_records (employee_id);
create index if not exists idx_leave_records_shift_date on leave_records (shift_date);

-- ============================================================================
-- 6. al_slot_ledger
-- ============================================================================
create table if not exists al_slot_ledger (
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
create table if not exists mwa_records (
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
create table if not exists det_records (
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

-- An employee cannot be detailed to two places for overlapping times.
-- Ranges are half-open [start, end), so sequential assignments that meet
-- exactly (e.g. 07:00-14:00 then 14:00-07:00) are allowed. span_end <= span_start
-- means the span crosses midnight into the next calendar day. Denied/Cancelled
-- records don't block.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'det_records_no_overlap') then
    alter table det_records add constraint det_records_no_overlap
      exclude using gist (
        employee_id with =,
        tsrange(
          shift_date + span_start,
          (shift_date + (case when span_end <= span_start then 1 else 0 end)) + span_end
        ) with &&
      ) where (status in ('PendingApproval','Approved'));
  end if;
end $$;

-- ============================================================================
-- 9. ot_availability
-- ============================================================================
create table if not exists ot_availability (
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

create index if not exists idx_ot_availability_employee on ot_availability (employee_id);

-- ============================================================================
-- 10. ot_requests
-- ============================================================================
create table if not exists ot_requests (
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

create index if not exists idx_ot_requests_shift_date on ot_requests (shift_date);

-- ============================================================================
-- 11. payroll_rows
-- ============================================================================
create table if not exists payroll_rows (
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

create index if not exists idx_payroll_rows_date_district on payroll_rows (shift_date, district);

-- ============================================================================
-- 12. timesheet_segments
-- ============================================================================
create table if not exists timesheet_segments (
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

create index if not exists idx_timesheet_segments_employee_pp on timesheet_segments (employee_id, pp_end);

-- ============================================================================
-- 13. shift_close
-- ============================================================================
create table if not exists shift_close (
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
create table if not exists audit_log (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  actor_type       text not null check (actor_type in ('member','supervisor','admin','system')),
  actor_id         uuid references employees(id),
  action           text not null,
  entry_id         text,
  detail           text
);

create index if not exists idx_audit_log_occurred_at on audit_log (occurred_at desc);

-- ============================================================================
-- 15. notifications_outbox
-- ============================================================================
create table if not exists notifications_outbox (
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

create index if not exists idx_notifications_outbox_unsent on notifications_outbox (queued_at) where sent_at is null;

-- ============================================================================
-- 16. roles
-- ============================================================================
create table if not exists roles (
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
create table if not exists settings (
  key              text primary key,
  value            text not null,
  description      text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references employees(id)
);

-- ============================================================================
-- Partial indexes required by spec
-- ============================================================================
create index if not exists idx_leave_records_open on leave_records (shift_date, employee_id)
  where status in ('Granted','Active','Waitlist');
create index if not exists idx_duty_ledger_not_closed on duty_ledger (shift_date) where is_closed = false;
create index if not exists idx_payroll_rows_shift_district on payroll_rows (shift_date, district);
create index if not exists idx_audit_log_recent on audit_log (occurred_at desc);

-- ============================================================================
-- 18. ot_tier_board  (materialized view)
-- ============================================================================
create materialized view if not exists ot_tier_board as
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

create unique index if not exists ot_tier_board_employee_id_idx on ot_tier_board (employee_id);

-- ============================================================================
-- Seed data
-- ============================================================================

-- Companies (real EBC/JPFD apparatus + district chief / assistant chief HQ codes)
-- District chiefs and the assistant chief are administrative (records_only = true),
-- excluded from the per-company minimum-staffing report in /api/workforce.
insert into companies (code, station, district, suffix_rule, records_only, station_override) values
  ('E118', 'Station 11', 120, '5 · Capt+LT+OP+2FF', false, null),
  ('E128', 'Station 12', 120, '5 · Capt+LT+2OP+FF', false, null),
  ('E198', 'Station 19', 120, '4 · Capt+OP+2FF', false, null),
  ('L117', 'Station 11', 120, '4 · LT+OP+2FF', false, 'Station 14'),
  ('C120', 'District 120 HQ', 120, '1 · DC', true, null),
  ('E148', 'Station 14', 140, '5 · Capt+LT+OP+2FF', false, null),
  ('E158', 'Station 15', 140, '5 · Capt+LT+OP+2FF', false, null),
  ('S159', 'Station 15', 140, '5 · LT+OP+3FF', false, null),
  ('E188', 'Station 18', 140, '5 · Capt+LT+OP+2FF', false, null),
  ('L187', 'Station 18', 140, '4 · LT+OP+2FF', false, null),
  ('C140', 'District 140 HQ', 140, '1 · DC', true, null),
  ('E138', 'Station 13', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('L137', 'Station 13', 160, '4 · LT+OP+2FF', false, null),
  ('E168', 'Station 16', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('S169', 'Station 16', 160, '4 · LT+OP+2FF', false, null),
  ('E178', 'Station 17', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('L177', 'Station 17', 160, '4 · LT+OP+2FF', false, null),
  ('E208', 'Station 20', 160, '5 · Capt+LT+OP+2FF', false, null),
  ('C160', 'District 160 HQ', 160, '1 · DC', true, null),
  ('C102', 'HQ', null, '1 · AC', true, null)
on conflict (code) do nothing;

-- Employees (real EBC/JPFD roster, A/B/C platoons, seeded 2026-07-16)
-- emp_number values are provisional sequential placeholders (3001+) pending real
-- payroll employee numbers -- none were supplied with this roster data.
-- District 120 B Platoon District Chief intentionally omitted: unconfirmed.
insert into employees (emp_number, last_name, first_name, middle_initial, rank, platoon, company_code, supervisor, status) values
  (3001, 'Bertucci Jr.', 'Ronald', 'J', 'DC', 'A', 'C120', true, 'Active'),
  (3002, 'Cunningham', 'C', null, 'Capt', 'A', 'E118', true, 'Active'),
  (3003, 'Parr', 'J', null, 'LT', 'A', 'E118', true, 'Active'),
  (3004, 'Ruffin', 'J', null, 'OP', 'A', 'E118', false, 'Active'),
  (3005, 'Soldani', 'J', null, 'FF', 'A', 'E118', false, 'Active'),
  (3006, 'Dimak', 'S', null, 'FF', 'A', 'E118', false, 'Active'),
  (3007, 'Wakefield', 'T', null, 'Capt', 'A', 'E128', true, 'Active'),
  (3008, 'May', 'J', null, 'LT', 'A', 'E128', true, 'Active'),
  (3009, 'Crucia', 'B', null, 'OP', 'A', 'E128', false, 'Active'),
  (3010, 'Lowe', 'B', null, 'OP', 'A', 'E128', false, 'Active'),
  (3011, 'Rizzuto', 'M', null, 'FF', 'A', 'E128', false, 'Active'),
  (3012, 'Beck', 'B', null, 'Capt', 'A', 'E198', true, 'Active'),
  (3013, 'Fox', 'B', null, 'OP', 'A', 'E198', false, 'Active'),
  (3014, 'Weinmann', 'J', null, 'FF', 'A', 'E198', false, 'Active'),
  (3015, 'Rodriguez', 'B', null, 'FF', 'A', 'E198', false, 'Active'),
  (3016, 'Haas IV', 'William', 'J', 'DC', 'A', 'C140', true, 'Active'),
  (3017, 'Labat', 'Michael', null, 'Capt', 'A', 'E148', true, 'Active'),
  (3018, 'Ward', 'Scott', null, 'LT', 'A', 'E148', true, 'Active'),
  (3019, 'Chenet', 'Henry', null, 'OP', 'A', 'E148', false, 'Active'),
  (3020, 'Orkus', 'Steve', null, 'FF', 'A', 'E148', false, 'Active'),
  (3021, 'Tournier', 'Shane', null, 'FF', 'A', 'E148', false, 'Active'),
  (3022, 'Barthel', 'B', null, 'LT', 'A', 'L117', true, 'Active'),
  (3023, 'Hoffmann', 'Wayne', null, 'Sub-LT', 'A', 'L117', true, 'Active'),
  (3024, 'Greco', 'S', null, 'OP', 'A', 'L117', false, 'Active'),
  (3025, 'Linn', 'C', null, 'FF', 'A', 'L117', false, 'Active'),
  (3026, 'Terrebonne', 'B', null, 'FF', 'A', 'L117', false, 'Active'),
  (3027, 'Willhoft', 'J', null, 'Capt', 'A', 'E158', true, 'Active'),
  (3028, 'Penot', 'Chad', null, 'LT', 'A', 'E158', true, 'Active'),
  (3029, 'Marks', 'Brandon', null, 'OP', 'A', 'E158', false, 'Active'),
  (3030, 'Raymond IV', 'Michael', null, 'FF', 'A', 'E158', false, 'Active'),
  (3031, 'Gaudet', 'C', null, 'FF', 'A', 'E158', false, 'Active'),
  (3032, 'Thezan', 'D', null, 'LT', 'A', 'S159', true, 'Active'),
  (3033, 'Figaro', 'N', null, 'OP', 'A', 'S159', false, 'Active'),
  (3034, 'Adkins', 'R', null, 'FF', 'A', 'S159', false, 'Active'),
  (3035, 'Alvarado', 'A', null, 'FF', 'A', 'S159', false, 'Active'),
  (3036, 'McGoey', 'J', null, 'FF', 'A', 'S159', false, 'Active'),
  (3037, 'Perre', 'Chris', null, 'Capt', 'A', 'E188', true, 'Active'),
  (3038, 'Bienvenu', 'Marc', null, 'LT', 'A', 'E188', true, 'Active'),
  (3039, 'Calamari', 'M', null, 'OP', 'A', 'E188', false, 'Active'),
  (3040, 'Marino', 'B', null, 'FF', 'A', 'E188', false, 'Active'),
  (3041, 'Cole', 'C', null, 'FF', 'A', 'E188', false, 'Active'),
  (3042, 'Cinquemano', 'A', null, 'LT', 'A', 'L187', true, 'Active'),
  (3043, 'Gradwhol', 'C', null, 'OP', 'A', 'L187', false, 'Active'),
  (3044, 'Puipuro', 'N', null, 'FF', 'A', 'L187', false, 'Active'),
  (3045, 'Babin', 'M', null, 'FF', 'A', 'L187', false, 'Active'),
  (3046, 'Burkett', 'Craig', 'M', 'DC', 'A', 'C160', true, 'Active'),
  (3047, 'Hux', 'Michael', null, 'Capt', 'A', 'E138', true, 'Active'),
  (3048, 'Grechauer', 'Jared', null, 'LT', 'A', 'E138', true, 'Active'),
  (3049, 'Mosbey', 'Joshua', null, 'OP', 'A', 'E138', false, 'Active'),
  (3050, 'Manino', 'Matt', null, 'FF', 'A', 'E138', false, 'Active'),
  (3051, 'Raines', 'Dylan', null, 'FF', 'A', 'E138', false, 'Active'),
  (3052, 'Civello', 'D', null, 'LT', 'A', 'L137', true, 'Active'),
  (3053, 'English', 'Jarrod', null, 'OP', 'A', 'L137', false, 'Active'),
  (3054, 'Mire', 'C', null, 'FF', 'A', 'L137', false, 'Active'),
  (3055, 'Raines', 'B', null, 'FF', 'A', 'L137', false, 'Active'),
  (3056, 'Bruzeau', 'R', null, 'Capt', 'A', 'E168', true, 'Active'),
  (3057, 'Stromeyer', 'S', null, 'LT', 'A', 'E168', true, 'Active'),
  (3058, 'Rome', 'E', null, 'OP', 'A', 'E168', false, 'Active'),
  (3059, 'Balser', 'L', null, 'FF', 'A', 'E168', false, 'Active'),
  (3060, 'Dudenhoeffer', 'J', null, 'FF', 'A', 'E168', false, 'Active'),
  (3061, 'Hebert', 'Matt', null, 'Capt', 'A', 'E178', true, 'Active'),
  (3062, 'Esteves', 'Brad', null, 'LT', 'A', 'E178', true, 'Active'),
  (3063, 'Boudoin', 'C', null, 'OP', 'A', 'E178', false, 'Active'),
  (3064, 'Guidry', 'Chris', null, 'FF', 'A', 'E178', false, 'Active'),
  (3065, 'Boudoin', 'Jason', null, 'FF', 'A', 'E178', false, 'Active'),
  (3066, 'Curole', 'N', null, 'LT', 'A', 'L177', true, 'Active'),
  (3067, 'Rucker', 'M', null, 'OP', 'A', 'L177', false, 'Active'),
  (3068, 'Lindsey', 'B', null, 'FF', 'A', 'L177', false, 'Active'),
  (3069, 'Pelicano', 'D', null, 'FF', 'A', 'L177', false, 'Active'),
  (3070, 'Gaudin', 'M', null, 'Capt', 'A', 'E208', true, 'Active'),
  (3071, 'Mullen', 'B', null, 'LT', 'A', 'E208', true, 'Active'),
  (3072, 'Jambon', 'K', null, 'OP', 'A', 'E208', false, 'Active'),
  (3073, 'Soto', 'M', null, 'FF', 'A', 'E208', false, 'Active'),
  (3074, 'Lowe', 'B', null, 'FF', 'A', 'E208', false, 'Active'),
  (3075, 'Easley', 'R', null, 'AC', 'A', 'C102', true, 'Active'),
  (3076, 'Krupp III', 'Emmett', null, 'DC', 'C', 'C120', true, 'Active'),
  (3077, 'Cook', 'D', null, 'Capt', 'C', 'E118', true, 'Active'),
  (3078, 'Withmeyer', 'D', null, 'LT', 'C', 'E118', true, 'Active'),
  (3079, 'Dill', 'S', null, 'OP', 'C', 'E118', false, 'Active'),
  (3080, 'Fury', 'W', null, 'FF', 'C', 'E118', false, 'Active'),
  (3081, 'Tew', 'J', null, 'FF', 'C', 'E118', false, 'Active'),
  (3082, 'Vitellaro', 'R', null, 'Capt', 'C', 'E128', true, 'Active'),
  (3083, 'Winchester', 'J', null, 'LT', 'C', 'E128', true, 'Active'),
  (3084, 'Bush', 'S', null, 'OP', 'C', 'E128', false, 'Active'),
  (3085, 'Spencer', 'K', null, 'FF', 'C', 'E128', false, 'Active'),
  (3086, 'Lorenzo', 'F', null, 'FF', 'C', 'E128', false, 'Active'),
  (3087, 'Adams', 'F', null, 'Capt', 'C', 'E198', true, 'Active'),
  (3088, 'Decker', 'M', null, 'LT', 'C', 'E198', true, 'Active'),
  (3089, 'Rigney', 'T', null, 'OP', 'C', 'E198', false, 'Active'),
  (3090, 'Navarro', 'N', null, 'FF', 'C', 'E198', false, 'Active'),
  (3091, 'Lobell', 'B', null, 'LT', 'C', 'L117', true, 'Active'),
  (3092, 'Cookmeyer', 'N', null, 'OP', 'C', 'L117', false, 'Active'),
  (3093, 'Hirstius', 'R', null, 'FF', 'C', 'L117', false, 'Active'),
  (3094, 'Lebon', 'P', null, 'FF', 'C', 'L117', false, 'Active'),
  (3095, 'Barrios Jr.', 'Brent', 'J', 'DC', 'C', 'C140', true, 'Active'),
  (3096, 'Schulin', 'S', null, 'Capt', 'C', 'E148', true, 'Active'),
  (3097, 'LaSalle', 'S', null, 'LT', 'C', 'E148', true, 'Active'),
  (3098, 'Gaudet', 'D', null, 'OP', 'C', 'E148', false, 'Active'),
  (3099, 'Liberto', 'D', null, 'FF', 'C', 'E148', false, 'Active'),
  (3100, 'Nunez', 'N', null, 'FF', 'C', 'E148', false, 'Active'),
  (3101, 'Schoder', 'M', null, 'Capt', 'C', 'E158', true, 'Active'),
  (3102, 'Puleo', 'R', null, 'LT', 'C', 'E158', true, 'Active'),
  (3103, 'Shillington', 'M', null, 'OP', 'C', 'E158', false, 'Active'),
  (3104, 'Willhoft Jr.', 'J', null, 'FF', 'C', 'E158', false, 'Active'),
  (3105, 'Ricalde', 'D', null, 'FF', 'C', 'E158', false, 'Active'),
  (3106, 'O''Neal', 'R', null, 'LT', 'C', 'S159', true, 'Active'),
  (3107, 'Rosenbohm', 'A', null, 'OP', 'C', 'S159', false, 'Active'),
  (3108, 'Dupuy', 'N', null, 'FF', 'C', 'S159', false, 'Active'),
  (3109, 'Bayer', 'A', null, 'FF', 'C', 'S159', false, 'Active'),
  (3110, 'Hale', 'S', null, 'FF', 'C', 'S159', false, 'Active'),
  (3111, 'Guyton', 'P', null, 'Capt', 'C', 'E188', true, 'Active'),
  (3112, 'Marino', 'J', null, 'LT', 'C', 'E188', true, 'Active'),
  (3113, 'Rodriguez', 'M', null, 'OP', 'C', 'E188', false, 'Active'),
  (3114, 'Juneau', 'M', null, 'FF', 'C', 'E188', false, 'Active'),
  (3115, 'Segretto', 'J', null, 'FF', 'C', 'E188', false, 'Active'),
  (3116, 'Monvoisin', 'K', null, 'LT', 'C', 'L187', true, 'Active'),
  (3117, 'Giusti', 'M', null, 'OP', 'C', 'L187', false, 'Active'),
  (3118, 'Cookmeyer', 'B', null, 'FF', 'C', 'L187', false, 'Active'),
  (3119, 'Hoffman', 'D', null, 'FF', 'C', 'L187', false, 'Active'),
  (3120, 'Corona III', 'Frank', null, 'DC', 'C', 'C160', true, 'Active'),
  (3121, 'Rigney', 'C', null, 'Capt', 'C', 'E138', true, 'Active'),
  (3122, 'Porche', 'E', null, 'LT', 'C', 'E138', true, 'Active'),
  (3123, 'Rivere', 'R', null, 'OP', 'C', 'E138', false, 'Active'),
  (3124, 'Gennaro', 'M', null, 'OP', 'C', 'E138', false, 'Active'),
  (3125, 'Mortillaro', 'P', null, 'FF', 'C', 'E138', false, 'Active'),
  (3126, 'Elvir', 'S', null, 'FF', 'C', 'E138', false, 'Active'),
  (3127, 'Schindler', 'B', null, 'LT', 'C', 'L137', true, 'Active'),
  (3128, 'Pansano', 'A', null, 'OP', 'C', 'L137', false, 'Active'),
  (3129, 'Brelet', 'B', null, 'FF', 'C', 'L137', false, 'Active'),
  (3130, 'Klumpp', 'J', null, 'Capt', 'C', 'E168', true, 'Active'),
  (3131, 'Boyle', 'J', null, 'LT', 'C', 'E168', true, 'Active'),
  (3132, 'Adams', 'M', null, 'OP', 'C', 'E168', false, 'Active'),
  (3133, 'Koch', 'C', null, 'FF', 'C', 'E168', false, 'Active'),
  (3134, 'Rodrigue', 'C', null, 'FF', 'C', 'E168', false, 'Active'),
  (3135, 'Rigney', 'S', null, 'LT', 'C', 'S169', true, 'Active'),
  (3136, 'Floyd', 'M', null, 'OP', 'C', 'S169', false, 'Active'),
  (3137, 'Galland', 'C', null, 'FF', 'C', 'S169', false, 'Active'),
  (3138, 'Dupuy', 'C', null, 'Capt', 'C', 'E178', true, 'Active'),
  (3139, 'Moser', 'E', null, 'LT', 'C', 'E178', true, 'Active'),
  (3140, 'Teachworth', 'M', null, 'OP', 'C', 'E178', false, 'Active'),
  (3141, 'Demma', 'J', null, 'FF', 'C', 'E178', false, 'Active'),
  (3142, 'Balestra', 'M', null, 'FF', 'C', 'E178', false, 'Active'),
  (3143, 'Smith', 'B', null, 'LT', 'C', 'L177', true, 'Active'),
  (3144, 'Collins', 'J', null, 'OP', 'C', 'L177', false, 'Active'),
  (3145, 'Virgadamo', 'T', null, 'FF', 'C', 'L177', false, 'Active'),
  (3146, 'Richards', 'B', null, 'FF', 'C', 'L177', false, 'Active'),
  (3147, 'Segretto Jr.', 'J', null, 'Capt', 'C', 'E208', true, 'Active'),
  (3148, 'Alvarez', 'R', null, 'LT', 'C', 'E208', true, 'Active'),
  (3149, 'Hymel', 'J', null, 'OP', 'C', 'E208', false, 'Active'),
  (3150, 'Bradshaw', 'R', null, 'FF', 'C', 'E208', false, 'Active'),
  (3151, 'Garcia', 'A', null, 'FF', 'C', 'E208', false, 'Active'),
  (3152, 'Aitken', 'J', null, 'AC', 'C', 'C102', true, 'Active'),
  (3153, 'Cook', 'D', null, 'Capt', 'B', 'E118', true, 'Active'),
  (3154, 'Rodrigue', 'S', null, 'LT', 'B', 'E118', true, 'Active'),
  (3155, 'Lambert', 'A', null, 'OP', 'B', 'E118', false, 'Active'),
  (3156, 'Farrelly', 'J', null, 'FF', 'B', 'E118', false, 'Active'),
  (3157, 'Hardy', 'R', null, 'FF', 'B', 'E118', false, 'Active'),
  (3158, 'Holiday', 'M', null, 'Capt', 'B', 'E128', true, 'Active'),
  (3159, 'Dunn', 'K', null, 'LT', 'B', 'E128', true, 'Active'),
  (3160, 'Jacob', 'G', null, 'OP', 'B', 'E128', false, 'Active'),
  (3161, 'Seitz', 'A', null, 'FF', 'B', 'E128', false, 'Active'),
  (3162, 'Taylor', 'C', null, 'FF', 'B', 'E128', false, 'Active'),
  (3163, 'Galland', 'T', null, 'Capt', 'B', 'E198', true, 'Active'),
  (3164, 'Conzonere', 'N', null, 'LT', 'B', 'E198', true, 'Active'),
  (3165, 'Heffner', 'R', null, 'OP', 'B', 'E198', false, 'Active'),
  (3166, 'Falgout', 'M', null, 'FF', 'B', 'E198', false, 'Active'),
  (3167, 'Roser', 'Todd', null, 'DC', 'B', 'C140', true, 'Active'),
  (3168, 'Harper', 'F', null, 'LT', 'B', 'L117', true, 'Active'),
  (3169, 'Jones', 'A', null, 'OP', 'B', 'L117', false, 'Active'),
  (3170, 'Bell', 'C', null, 'FF', 'B', 'L117', false, 'Active'),
  (3171, 'Huth', 'J', null, 'Capt', 'B', 'E148', true, 'Active'),
  (3172, 'Bozeman', 'T', null, 'LT', 'B', 'E148', true, 'Active'),
  (3173, 'Couvillion', 'C', null, 'OP', 'B', 'E148', false, 'Active'),
  (3174, 'Hymel', 'C', null, 'FF', 'B', 'E148', false, 'Active'),
  (3175, 'Esteves', 'T', null, 'FF', 'B', 'E148', false, 'Active'),
  (3176, 'Schultz', 'T', null, 'Capt', 'B', 'E158', true, 'Active'),
  (3177, 'Gegenheimer', 'G', null, 'LT', 'B', 'E158', true, 'Active'),
  (3178, 'Shannon', 'J', null, 'OP', 'B', 'E158', false, 'Active'),
  (3179, 'Hopkins', 'B', null, 'FF', 'B', 'E158', false, 'Active'),
  (3180, 'Jones', 'J', null, 'FF', 'B', 'E158', false, 'Active'),
  (3181, 'Rodrigue', 'B', null, 'LT', 'B', 'S159', true, 'Active'),
  (3182, 'Davis', 'J', null, 'OP', 'B', 'S159', false, 'Active'),
  (3183, 'Mattio', 'B', null, 'FF', 'B', 'S159', false, 'Active'),
  (3184, 'Thomassie', 'C', null, 'FF', 'B', 'S159', false, 'Active'),
  (3185, 'Leblanc', 'K', null, 'Capt', 'B', 'E188', true, 'Active'),
  (3186, 'Hardy', 'R', null, 'LT', 'B', 'E188', true, 'Active'),
  (3187, 'Wilson', 'J', null, 'OP', 'B', 'E188', false, 'Active'),
  (3188, 'Smith', 'J', null, 'FF', 'B', 'E188', false, 'Active'),
  (3189, 'Sterling', 'J', null, 'FF', 'B', 'E188', false, 'Active'),
  (3190, 'Colomb', 'M', null, 'Sub-LT', 'B', 'L187', true, 'Active'),
  (3191, 'Clark', 'C', null, 'OP', 'B', 'L187', false, 'Active'),
  (3192, 'Crossen', 'J', null, 'FF', 'B', 'L187', false, 'Active'),
  (3193, 'Balser', 'Milton', null, 'DC', 'B', 'C160', true, 'Active'),
  (3194, 'Lemoine', 'M', null, 'Capt', 'B', 'E138', true, 'Active'),
  (3195, 'Moskau', 'T', null, 'Sub-LT', 'B', 'E138', true, 'Active'),
  (3196, 'Glover', 'P', null, 'OP', 'B', 'E138', false, 'Active'),
  (3197, 'Baltz', 'J', null, 'FF', 'B', 'E138', false, 'Active'),
  (3198, 'Juneau', 'G', null, 'FF', 'B', 'E138', false, 'Active'),
  (3199, 'Juneau', 'C', null, 'LT', 'B', 'L137', true, 'Active'),
  (3200, 'Arbaugh', 'M', null, 'OP', 'B', 'L137', false, 'Active'),
  (3201, 'Soignier', 'S', null, 'FF', 'B', 'L137', false, 'Active'),
  (3202, 'Loisel', 'C', null, 'FF', 'B', 'L137', false, 'Active'),
  (3203, 'Crossen', 'K', null, 'Capt', 'B', 'E168', true, 'Active'),
  (3204, 'Gremillion', 'M', null, 'LT', 'B', 'E168', true, 'Active'),
  (3205, 'Calamari', 'M', null, 'OP', 'B', 'E168', false, 'Active'),
  (3206, 'Mire', 'D', null, 'FF', 'B', 'E168', false, 'Active'),
  (3207, 'Labat', 'M', 'J', 'LT', 'B', 'S169', true, 'Active'),
  (3208, 'Crombie', 'B', null, 'OP', 'B', 'S169', false, 'Active'),
  (3209, 'Crossen', 'W', null, 'FF', 'B', 'S169', false, 'Active'),
  (3210, 'Nelson', 'D', null, 'FF', 'B', 'S169', false, 'Active'),
  (3211, 'Patureau', 'J', null, 'Sub-CAPT', 'B', 'E178', true, 'Active'),
  (3212, 'Glorioso', 'M', null, 'Capt', 'B', 'E178', true, 'Active'),
  (3213, 'Carver', 'C', null, 'LT', 'B', 'E178', true, 'Active'),
  (3214, 'Brown', 'A', null, 'OP', 'B', 'E178', false, 'Active'),
  (3215, 'Abide', 'J', null, 'FF', 'B', 'E178', false, 'Active'),
  (3216, 'Giarrusso', 'M', null, 'LT', 'B', 'L177', true, 'Active'),
  (3217, 'Tew', 'J', null, 'OP', 'B', 'L177', false, 'Active'),
  (3218, 'Moskau', 'P', null, 'FF', 'B', 'L177', false, 'Active'),
  (3219, 'Hughes', 'E', null, 'FF', 'B', 'L177', false, 'Active'),
  (3220, 'Schultz', 'W', null, 'FF', 'B', 'L177', false, 'Active'),
  (3221, 'Mooney', 'C', null, 'Capt', 'B', 'E208', true, 'Active'),
  (3222, 'Vaccaro', 'S', null, 'LT', 'B', 'E208', true, 'Active'),
  (3223, 'Lama', 'A', null, 'OP', 'B', 'E208', false, 'Active'),
  (3224, 'White', 'C', null, 'FF', 'B', 'E208', false, 'Active'),
  (3225, 'Cardinale', 'J', null, 'AC', 'B', 'C102', true, 'Active')
on conflict (emp_number) do nothing;

-- Rotation schedule 2026-07-01 through 2026-12-31
-- Source of truth: data/Jefferson_Parish_Fire_Corrected_Master_Schedule_1990-2075.md
-- Each platoon runs a 15-day repeating cycle, on duty on cycle days 1,3,5,7,9
-- (5 shifts), off on cycle days 10-15 (6 days). Anchors are each platoon's
-- cycle-day-1 date, spaced 5 days apart so exactly one platoon is on duty
-- any given day. Verified against all 31,411 rows of the master file with
-- zero mismatches.
-- Pay periods are 14-day blocks anchored to the confirmed Saturday
-- 2026-05-30 07:00 pay-period start.
do $$
declare
  d              date    := '2026-07-01';
  end_date       date    := '2026-12-31';
  anchor_a       date    := '2025-01-03';
  anchor_b       date    := '2025-01-08';
  anchor_c       date    := '2025-01-13';
  pp_anchor      date    := '2026-05-30';
  duty_days      integer[] := array[1,3,5,7,9];
  day_in_cycle_a integer;
  day_in_cycle_b integer;
  day_in_cycle_c integer;
  plt            char(1);
  days_since_pp  integer;
  pp_start_d     date;
  pp_end_d       date;
begin
  while d <= end_date loop
    day_in_cycle_a := ((d - anchor_a) % 15 + 15) % 15 + 1;
    day_in_cycle_b := ((d - anchor_b) % 15 + 15) % 15 + 1;
    day_in_cycle_c := ((d - anchor_c) % 15 + 15) % 15 + 1;

    if day_in_cycle_a = any(duty_days) then plt := 'A';
    elsif day_in_cycle_b = any(duty_days) then plt := 'B';
    elsif day_in_cycle_c = any(duty_days) then plt := 'C';
    else
      raise exception 'no platoon on duty for %', d;
    end if;

    days_since_pp := d - pp_anchor;
    pp_start_d    := pp_anchor + (floor(days_since_pp::numeric / 14) * 14)::integer;
    pp_end_d      := pp_start_d + 13;

    insert into rotation_schedule (shift_date, platoon, pp_start, pp_end)
    values (d, plt, pp_start_d, pp_end_d)
    on conflict (shift_date) do update
      set platoon  = excluded.platoon,
          pp_start = excluded.pp_start,
          pp_end   = excluded.pp_end;

    d := d + 1;
  end loop;
end $$;

-- Leave records reflecting each platoon roster's noted leave status as of 2026-07-16.
-- status = 'Active' (currently in effect). Entries with a stated partial-hour figure
-- keep the default full-shift span and record the actual hours in `reason` -- no exact
-- clock times were provided for those partial-day entries.
insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-001', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3022
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-002', id, 'AL', '2026-07-16', '07:00', '19:00', 'AL - 13 hrs', 'Active', now()
from employees where emp_number = 3153
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-003', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3159
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-004', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3161
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-005', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3162
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-006', id, 'AL', '2026-07-16', '07:00', '19:00', 'AL - 9 hrs', 'Active', now()
from employees where emp_number = 3163
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-007', id, 'SL', '2026-07-16', '07:00', '19:00', 'SL - 5 hrs', 'Active', now()
from employees where emp_number = 3166
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-008', id, 'AL', '2026-07-16', '07:00', '19:00', 'AL - 2 hrs', 'Active', now()
from employees where emp_number = 3168
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-009', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3169
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-010', id, 'FODI', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3170
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-011', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3183
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-012', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3203
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-013', id, 'CT', '2026-07-16', '07:00', '19:00', 'CT - 17 hrs', 'Active', now()
from employees where emp_number = 3209
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-014', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3212
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-015', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3216
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-016', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3218
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-017', id, 'SL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3219
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-018', id, 'ISSL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3220
on conflict (entry_id) do nothing;

insert into leave_records (entry_id, employee_id, leave_type, shift_date, span_start, span_end, reason, status, submitted_at)
select 'LV20260716-019', id, 'AL', '2026-07-16', '07:00', '19:00', null, 'Active', now()
from employees where emp_number = 3222
on conflict (entry_id) do nothing;
-- Settings
insert into settings (key, value, description) values
  ('max_al_slots_per_shift', '12',        'Maximum concurrent AL slots allowed per platoon per shift'),
  ('shift_start_time',       '07:00',     'Standard shift start time (24h)'),
  ('timezone',               'America/Chicago', 'Application timezone for all shift date logic'),
  ('packet_email_time',      '08:15',     'Local time the shift-packet cron job runs'),
  ('admin_email',            'admin@ebc-fire.org', 'Fallback recipient for admin notifications'),
  ('ladder_117_temp_station', 'Station 14', 'Ladder 117 is temporarily housed at Station 14 while Station 11 undergoes renovation (normal home = Station 11, companies.station_override). Expected to last up to 2 years from 2026-07-16.')
on conflict (key) do nothing;
