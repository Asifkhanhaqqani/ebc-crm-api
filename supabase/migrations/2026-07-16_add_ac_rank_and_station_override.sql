-- ============================================================================
-- Schema changes needed before seeding the real employee roster:
--   1. employees.rank needs an 'AC' (Assistant Chief) value -- the existing
--      enum only covers DC/Sub-DC/Capt/Sub-CAPT/LT/Sub-LT/OP/FF.
--   2. companies needs a station_override column, for cases like Ladder 117
--      being temporarily housed away from its home station.
--
-- Safe to run multiple times. Run this in the Supabase SQL Editor before
-- 2026-07-16_seed_real_roster.sql.
-- ============================================================================

alter table employees drop constraint if exists employees_rank_check;
alter table employees add constraint employees_rank_check
  check (rank in ('DC','Sub-DC','AC','Capt','Sub-CAPT','LT','Sub-LT','OP','FF'));

alter table companies add column if not exists station_override text;
