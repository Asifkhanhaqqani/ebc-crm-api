-- ============================================================================
-- EBC/JPFD Workforce CRM — Triggers
-- Run after schema.sql, before rls_policies.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. set_updated_at() — BEFORE UPDATE on every table with updated_at
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_updated_at_companies            before update on companies            for each row execute function set_updated_at();
create trigger trg_updated_at_employees             before update on employees             for each row execute function set_updated_at();
create trigger trg_updated_at_duty_ledger           before update on duty_ledger           for each row execute function set_updated_at();
create trigger trg_updated_at_leave_records         before update on leave_records         for each row execute function set_updated_at();
create trigger trg_updated_at_mwa_records           before update on mwa_records           for each row execute function set_updated_at();
create trigger trg_updated_at_det_records           before update on det_records           for each row execute function set_updated_at();
create trigger trg_updated_at_ot_availability       before update on ot_availability       for each row execute function set_updated_at();
create trigger trg_updated_at_ot_requests           before update on ot_requests           for each row execute function set_updated_at();
create trigger trg_updated_at_payroll_rows          before update on payroll_rows          for each row execute function set_updated_at();
create trigger trg_updated_at_shift_close           before update on shift_close           for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. write_audit_on_leave_change() — AFTER INSERT OR UPDATE on leave_records
-- ----------------------------------------------------------------------------
create or replace function write_audit_on_leave_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  begin
    v_actor_id := nullif(current_setting('app.actor_id', true), '')::uuid;
  exception when others then
    v_actor_id := null;
  end;

  insert into audit_log (actor_type, actor_id, action, entry_id, detail)
  values (
    'system',
    v_actor_id,
    'leave.' || (case tg_op when 'INSERT' then 'submit' else 'update' end),
    new.entry_id,
    new.status || ' · ' || new.leave_type || ' · ' || new.shift_date
  );

  return new;
end;
$$;

create trigger trg_write_audit_on_leave_change
  after insert or update on leave_records
  for each row execute function write_audit_on_leave_change();

-- ----------------------------------------------------------------------------
-- 3. rebuild_al_slot_ledger() — AFTER INSERT OR UPDATE OR DELETE on leave_records
-- ----------------------------------------------------------------------------
create or replace function rebuild_al_slot_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row leave_records;
  v_platoon char(1);
  v_shift_date date;
  v_peak integer;
begin
  v_row := coalesce(new, old);

  if v_row.leave_type is distinct from 'AL' then
    return v_row;
  end if;

  select e.platoon into v_platoon from employees e where e.id = v_row.employee_id;
  v_shift_date := v_row.shift_date;

  if v_platoon is null then
    return v_row;
  end if;

  -- Sweep-line peak-concurrency calc: for every span start point, count
  -- how many Granted/Active AL spans on this platoon+date contain it.
  select coalesce(max(concurrent_count), 0) into v_peak
  from (
    select
      pt.t,
      (
        select count(*)
        from leave_records lr2
        join employees e2 on e2.id = lr2.employee_id
        where lr2.leave_type = 'AL'
          and lr2.status in ('Granted', 'Active')
          and lr2.shift_date = v_shift_date
          and e2.platoon = v_platoon
          and lr2.span_start <= pt.t
          and lr2.span_end > pt.t
      ) as concurrent_count
    from (
      select distinct lr.span_start as t
      from leave_records lr
      join employees e on e.id = lr.employee_id
      where lr.leave_type = 'AL'
        and lr.status in ('Granted', 'Active')
        and lr.shift_date = v_shift_date
        and e.platoon = v_platoon
    ) pt
  ) sweep;

  delete from al_slot_ledger where platoon = v_platoon and shift_date = v_shift_date;

  insert into al_slot_ledger (platoon, shift_date, peak_concurrent, max_slots, last_rebuilt_at)
  values (v_platoon, v_shift_date, v_peak, 12, now())
  on conflict (platoon, shift_date)
  do update set peak_concurrent = excluded.peak_concurrent, last_rebuilt_at = now();

  return v_row;
end;
$$;

create trigger trg_rebuild_al_slot_ledger
  after insert or update or delete on leave_records
  for each row execute function rebuild_al_slot_ledger();

-- ----------------------------------------------------------------------------
-- 4. prevent_audit_log_mutation() — BEFORE UPDATE OR DELETE on audit_log
-- ----------------------------------------------------------------------------
create or replace function prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is immutable — no updates or deletes allowed';
end;
$$;

create trigger trg_prevent_audit_log_update
  before update on audit_log
  for each row execute function prevent_audit_log_mutation();

create trigger trg_prevent_audit_log_delete
  before delete on audit_log
  for each row execute function prevent_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- 5. refresh_ot_tier_board() — callable via supabaseAdmin.rpc() from the
--    backend's otTierService before reading the materialized view.
-- ----------------------------------------------------------------------------
create or replace function refresh_ot_tier_board()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently ot_tier_board;
end;
$$;
