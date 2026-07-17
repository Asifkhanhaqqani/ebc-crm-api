-- ============================================================================
-- Add 'Train' to the duty_ledger duty_status list.
--
-- Training is NOT leave: the employee stays listed on the workforce sheet
-- with status Train, is excluded from on-duty and minimum-staffing counts
-- (a station may go short because of Train), but keeps normal O work credit
-- on timesheet and payroll — Train never reduces pay or hours.
--
-- Safe to run multiple times (drop + re-add of the check constraint).
-- Run in the Supabase SQL Editor against the live project.
-- ============================================================================

alter table duty_ledger drop constraint if exists duty_ledger_duty_status_check;
alter table duty_ledger add constraint duty_ledger_duty_status_check
  check (duty_status in ('O','Train','AL','SL','EAL','ISSL','FODI','ADM','AWOL','FL','CT','CL','DET','MWA','OWD'));
