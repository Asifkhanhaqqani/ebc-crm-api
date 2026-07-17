import { supabaseAdmin } from '../config';
import { logger } from '../logger';

// Source of truth: data/Jefferson_Parish_Fire_Corrected_Master_Schedule_1990-2075.md
// Each platoon runs a 15-day repeating cycle, on duty on cycle days 1,3,5,7,9,
// off on cycle days 10-15. Anchors are each platoon's cycle-day-1 date.
const ANCHOR_A = '2025-01-03';
const ANCHOR_B = '2025-01-08';
const ANCHOR_C = '2025-01-13';
const DUTY_DAYS = [1, 3, 5, 7, 9];
const CYCLE_LENGTH = 15;

const START_DATE = '2026-01-01';
const END_DATE = '2026-12-30';

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const dateA = new Date(`${a}T00:00:00Z`).getTime();
  const dateB = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((dateB - dateA) / msPerDay);
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayInCycle(dateStr: string, anchor: string): number {
  const diff = daysBetween(anchor, dateStr);
  return (((diff % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH) + 1;
}

/** Expected platoon for a date under the 15-day cycle (A/B/C anchors 5 days apart). */
function expectedPlatoon(dateStr: string): string {
  if (DUTY_DAYS.includes(dayInCycle(dateStr, ANCHOR_A))) return 'A';
  if (DUTY_DAYS.includes(dayInCycle(dateStr, ANCHOR_B))) return 'B';
  if (DUTY_DAYS.includes(dayInCycle(dateStr, ANCHOR_C))) return 'C';
  throw new Error(`no platoon on duty for ${dateStr}`);
}

async function main() {
  const { data, error } = await supabaseAdmin
    .from('rotation_schedule')
    .select('shift_date, platoon')
    .gte('shift_date', START_DATE)
    .lte('shift_date', END_DATE);

  if (error) {
    logger.error('verifyRotation: failed to fetch rotation_schedule', { error });
    process.exit(1);
    return;
  }

  const actualByDate = new Map((data ?? []).map((row) => [row.shift_date, row.platoon]));

  let failures = 0;
  let cursor = START_DATE;

  while (cursor <= END_DATE) {
    const expected = expectedPlatoon(cursor);
    const actual = actualByDate.get(cursor);

    if (actual === expected) {
      console.log(`PASS  ${cursor}  expected=${expected} actual=${actual}`);
    } else {
      failures += 1;
      console.log(`FAIL  ${cursor}  expected=${expected} actual=${actual ?? 'MISSING'}`);
    }

    cursor = addDaysIso(cursor, 1);
  }

  if (failures > 0) {
    console.error(`\n${failures} date(s) failed rotation verification.`);
    process.exit(1);
  }

  console.log('\nAll dates passed rotation verification.');
}

if (require.main === module) {
  main();
}
