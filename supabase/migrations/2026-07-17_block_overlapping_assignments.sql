-- ============================================================================
-- Block double-booking: same employee, overlapping times, two places.
--
-- 1. det_records_no_overlap — exclusion constraint rejecting two DET entries
--    for the same employee with overlapping time ranges. Ranges are half-open
--    [start, end), so sequential assignments that meet exactly (e.g. L137
--    07:00-14:00 then E148 14:00-07:00) are allowed. span_end <= span_start
--    means the span crosses midnight. Denied/Cancelled records don't block.
--
-- 2. block_det_during_leave trigger — an employee on Granted/Active leave for
--    a time range cannot be entered on DET for that same range; the leave must
--    be amended in its original record first.
--
-- NOTE: existing det_records rows that already violate the constraint will
-- make the ALTER fail — resolve any such rows first (there should be none;
-- the table is empty pre-launch).
--
-- Safe to run multiple times. Run in the Supabase SQL Editor against the
-- live project.
-- ============================================================================

create extension if not exists btree_gist;

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

create or replace function block_det_during_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leave leave_records;
  v_det_range tsrange;
  v_leave_range tsrange;
begin
  if new.status not in ('PendingApproval', 'Approved') then
    return new;
  end if;

  v_det_range := tsrange(
    new.shift_date + new.span_start,
    (new.shift_date + (case when new.span_end <= new.span_start then 1 else 0 end)) + new.span_end
  );

  for v_leave in
    select * from leave_records lr
    where lr.employee_id = new.employee_id
      and lr.status in ('Granted', 'Active')
      and lr.shift_date between new.shift_date - 1 and new.shift_date + 1
  loop
    v_leave_range := tsrange(
      v_leave.shift_date + v_leave.span_start,
      (v_leave.shift_date + (case when v_leave.span_end <= v_leave.span_start then 1 else 0 end)) + v_leave.span_end
    );

    if v_det_range && v_leave_range then
      raise exception 'LEAVE_CONFLICT: employee has approved % leave %–% on % — amend the leave record before assigning duty',
        v_leave.leave_type, v_leave.span_start, v_leave.span_end, v_leave.shift_date;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_block_det_during_leave on det_records;
create trigger trg_block_det_during_leave
  before insert or update on det_records
  for each row execute function block_det_during_leave();
