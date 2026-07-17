-- ============================================================================
-- SUPERSEDED — do not run this file.
--
-- This migration used a simple 3-day A/B/C cycle, which only happened to be
-- correct for 2026-07-16 itself. The real Jefferson Parish FD schedule is a
-- 15-day cycle (5 duty days, 6 off), confirmed against
-- data/Jefferson_Parish_Fire_Corrected_Master_Schedule_1990-2075.md.
-- Use 2026-07-17_fix_rotation_15day_cycle.sql instead.
-- ============================================================================
-- ============================================================================
-- Fix rotation_schedule platoon assignments.
--
-- The seed formula anchored on 2026-01-01 = Platoon B (cycling B->C->A) put
-- 2026-07-16 on C Platoon. The owner confirmed 2026-07-16 = A Platoon, so
-- the cycle is re-anchored directly on that confirmed date. This does not
-- change the relative A->B->C->A cycle order, only its phase.
--
-- Safe to run multiple times (idempotent recompute, no rows added/removed).
-- Run this in the Supabase SQL Editor against the live project.
-- ============================================================================

update rotation_schedule
set platoon = case ((shift_date - date '2026-07-16') % 3 + 3) % 3
                when 0 then 'A'
                when 1 then 'B'
                else 'C'
              end;
