-- ============================================================================
-- Complete the rank list with the missing Sub ranks.
--
-- Required list (seniority order): AC, Sub-AC, DC, Sub-DC, Capt, Sub-CAPT,
-- LT, Sub-LT, OP, Sub-OP, FF, Sub-FF. Previously missing: Sub-AC, Sub-OP,
-- Sub-FF. A "Sub" works in the higher capacity for LONG periods; "Acting"
-- (24h or less) is not a rank — it remains acting_note on payroll.
--
-- Safe to run multiple times (drop + re-add of the check constraint).
-- Run in the Supabase SQL Editor against the live project.
-- ============================================================================

alter table employees drop constraint if exists employees_rank_check;
alter table employees add constraint employees_rank_check
  check (rank in ('AC','Sub-AC','DC','Sub-DC','Capt','Sub-CAPT','LT','Sub-LT','OP','Sub-OP','FF','Sub-FF'));
