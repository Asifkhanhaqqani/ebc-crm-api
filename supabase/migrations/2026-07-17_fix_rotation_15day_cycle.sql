-- ============================================================================
-- Fix rotation_schedule platoon assignments to the real 15-day JPFD cycle.
--
-- Supersedes 2026-07-16_fix_rotation_anchor.sql, which used a simple 3-day
-- A/B/C cycle. That formula only happened to agree with the real schedule
-- on 2026-07-16 itself and was wrong for most other dates (20 of 31 days
-- mismatched in July 2026 alone).
--
-- Source of truth: data/Jefferson_Parish_Fire_Corrected_Master_Schedule_1990-2075.md
-- Each platoon runs a 15-day repeating cycle, on duty on cycle days
-- 1,3,5,7,9 (five 24-hour shifts), off on cycle days 10-15 (six days).
-- Anchors are each platoon's cycle-day-1 date: A=2025-01-03, B=2025-01-08,
-- C=2025-01-13. Verified against all 31,411 rows of the master file with
-- zero mismatches.
--
-- Also recomputes pp_start/pp_end against the confirmed pay-period anchor
-- Saturday 2026-05-30 07:00 (14-day periods), replacing the earlier
-- 2026-01-01 anchor.
--
-- Safe to run multiple times (idempotent recompute, no rows added/removed).
-- Run this in the Supabase SQL Editor against the live project, after
-- 2026-07-16_add_ac_rank_and_station_override.sql.
-- ============================================================================

update rotation_schedule
set platoon = case
                when ((shift_date - date '2025-01-03') % 15 + 15) % 15 + 1 = any(array[1,3,5,7,9]) then 'A'
                when ((shift_date - date '2025-01-08') % 15 + 15) % 15 + 1 = any(array[1,3,5,7,9]) then 'B'
                else 'C'
              end,
    pp_start = date '2026-05-30' + (floor((shift_date - date '2026-05-30')::numeric / 14) * 14)::integer,
    pp_end   = date '2026-05-30' + (floor((shift_date - date '2026-05-30')::numeric / 14) * 14)::integer + 13;
