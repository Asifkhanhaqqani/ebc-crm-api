-- ============================================================================
-- EBC/JPFD Workforce CRM — Row Level Security Policies
-- Run after schema.sql and triggers.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

-- Resolve the employees.id row for the currently authenticated auth.uid(),
-- assuming employees.email matches the Supabase auth user's email.
create or replace function auth_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from employees e
  join auth.users u on u.email = e.email
  where u.id = auth.uid()
  limit 1;
$$;

create or replace function auth_has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from roles r
    where r.employee_id = auth_employee_id()
      and r.role = p_role
  );
$$;

create or replace function auth_is_supervisor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth_has_role('supervisor') or auth_has_role('admin');
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS on all tables
-- ----------------------------------------------------------------------------
alter table companies enable row level security;
alter table employees enable row level security;
alter table rotation_schedule enable row level security;
alter table duty_ledger enable row level security;
alter table leave_records enable row level security;
alter table al_slot_ledger enable row level security;
alter table mwa_records enable row level security;
alter table det_records enable row level security;
alter table ot_availability enable row level security;
alter table ot_requests enable row level security;
alter table payroll_rows enable row level security;
alter table timesheet_segments enable row level security;
alter table shift_close enable row level security;
alter table audit_log enable row level security;
alter table notifications_outbox enable row level security;
alter table roles enable row level security;
alter table settings enable row level security;

-- ----------------------------------------------------------------------------
-- employees
-- ----------------------------------------------------------------------------
create policy employees_select_authenticated on employees
  for select to authenticated
  using (status = 'Active' or auth_is_supervisor_or_admin());

create policy employees_insert_supervisor_admin on employees
  for insert to authenticated
  with check (auth_is_supervisor_or_admin());

create policy employees_update_supervisor_admin on employees
  for update to authenticated
  using (auth_is_supervisor_or_admin())
  with check (auth_is_supervisor_or_admin());

-- DELETE intentionally has no policy — nobody may delete; use status='Inactive'.

-- ----------------------------------------------------------------------------
-- leave_records
-- ----------------------------------------------------------------------------
create policy leave_records_select_own_or_supervisor on leave_records
  for select to authenticated
  using (employee_id = auth_employee_id() or auth_is_supervisor_or_admin());

create policy leave_records_insert_own on leave_records
  for insert to authenticated
  with check (employee_id = auth_employee_id());

create policy leave_records_update_supervisor_status on leave_records
  for update to authenticated
  using (auth_is_supervisor_or_admin())
  with check (auth_is_supervisor_or_admin());

create policy leave_records_delete_own_pending_within_hour on leave_records
  for delete to authenticated
  using (
    employee_id = auth_employee_id()
    and status = 'PendingApproval'
    and submitted_at > now() - interval '1 hour'
  );

-- ----------------------------------------------------------------------------
-- audit_log
-- ----------------------------------------------------------------------------
create policy audit_log_select_supervisor_admin on audit_log
  for select to authenticated
  using (auth_is_supervisor_or_admin());

create policy audit_log_insert_authenticated on audit_log
  for insert to authenticated
  with check (true);

-- UPDATE/DELETE: no policies — enforced additionally by trigger.

-- ----------------------------------------------------------------------------
-- payroll_rows / timesheet_segments / shift_close — service role only writes
-- ----------------------------------------------------------------------------
create policy payroll_rows_select_authenticated on payroll_rows
  for select to authenticated using (true);
create policy payroll_rows_write_service_role on payroll_rows
  for all to service_role using (true) with check (true);

create policy timesheet_segments_select_authenticated on timesheet_segments
  for select to authenticated using (true);
create policy timesheet_segments_write_service_role on timesheet_segments
  for all to service_role using (true) with check (true);

create policy shift_close_select_authenticated on shift_close
  for select to authenticated using (true);
create policy shift_close_write_service_role on shift_close
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- settings
-- ----------------------------------------------------------------------------
create policy settings_select_authenticated on settings
  for select to authenticated using (true);

create policy settings_update_admin on settings
  for update to authenticated
  using (auth_has_role('admin'))
  with check (auth_has_role('admin'));

-- ----------------------------------------------------------------------------
-- notifications_outbox
-- ----------------------------------------------------------------------------
create policy notifications_outbox_select_admin on notifications_outbox
  for select to authenticated
  using (auth_has_role('admin'));

create policy notifications_outbox_write_service_role on notifications_outbox
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Remaining tables: authenticated read, service role write
-- (companies, rotation_schedule, duty_ledger, al_slot_ledger, mwa_records,
--  det_records, ot_availability, ot_requests, roles)
-- ----------------------------------------------------------------------------
create policy companies_select_authenticated on companies
  for select to authenticated using (true);
create policy companies_write_service_role on companies
  for all to service_role using (true) with check (true);

create policy rotation_schedule_select_authenticated on rotation_schedule
  for select to authenticated using (true);
create policy rotation_schedule_write_service_role on rotation_schedule
  for all to service_role using (true) with check (true);

create policy duty_ledger_select_authenticated on duty_ledger
  for select to authenticated using (true);
create policy duty_ledger_write_supervisor_admin on duty_ledger
  for insert to authenticated with check (auth_is_supervisor_or_admin());
create policy duty_ledger_update_supervisor_admin on duty_ledger
  for update to authenticated
  using (auth_is_supervisor_or_admin())
  with check (auth_is_supervisor_or_admin());
create policy duty_ledger_write_service_role on duty_ledger
  for all to service_role using (true) with check (true);

create policy al_slot_ledger_select_authenticated on al_slot_ledger
  for select to authenticated using (true);
create policy al_slot_ledger_write_service_role on al_slot_ledger
  for all to service_role using (true) with check (true);

create policy mwa_records_select_own_or_supervisor on mwa_records
  for select to authenticated
  using (employee_id = auth_employee_id() or auth_is_supervisor_or_admin());
create policy mwa_records_write_service_role on mwa_records
  for all to service_role using (true) with check (true);

create policy det_records_select_own_or_supervisor on det_records
  for select to authenticated
  using (employee_id = auth_employee_id() or auth_is_supervisor_or_admin());
create policy det_records_write_service_role on det_records
  for all to service_role using (true) with check (true);

create policy ot_availability_select_authenticated on ot_availability
  for select to authenticated using (true);
create policy ot_availability_insert_own on ot_availability
  for insert to authenticated with check (employee_id = auth_employee_id());
create policy ot_availability_delete_own on ot_availability
  for delete to authenticated using (employee_id = auth_employee_id());

create policy ot_requests_select_authenticated on ot_requests
  for select to authenticated using (true);
create policy ot_requests_write_service_role on ot_requests
  for all to service_role using (true) with check (true);

create policy roles_select_authenticated on roles
  for select to authenticated using (true);
create policy roles_write_admin on roles
  for all to authenticated
  using (auth_has_role('admin'))
  with check (auth_has_role('admin'));

-- ============================================================================
-- NOTE: The backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses all RLS.
-- RLS protects direct Supabase client calls from the frontend (anon key only).
-- The frontend only ever calls the Express API — it never queries Supabase directly
-- except for Auth (session management).
-- ============================================================================
