// Port of features/physical/diet.py + weekly_average.py — same math, same
// tolerances. Dates are "YYYY-MM-DD" strings; weekly averages keyed by Monday.

import type { DietHistoryEntry, DietPhase, DietSettings } from "./types";

export const PHASE_TARGETS: Record<DietPhase, [number, number]> = {
  cut: [-0.005, -0.005],
  bulk: [0.005, 0.01],
};

export const KCAL_PER_LB = 500; // ~3500 kcal/lb of bodyweight, spread over a week
export const LOOKBACK_WEEKS = 6;

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const dow = (copy.getDay() + 6) % 7; // JS Sunday=0 → Mon-based index
  copy.setDate(copy.getDate() - dow);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Average of every Mon–Sun week that has at least one weigh-in.
 *  Keyed by Monday ISO. Weeks whose Sunday hasn't happened are still included
 *  so the UI can render a live "current week" average — callers that need only
 *  completed weeks filter by `monday < mondayOf(today)`. */
export function computeWeeklyAverages(
  daily: Record<string, number>
): Record<string, number> {
  const weeks: Record<string, { sum: number; n: number }> = {};
  for (const [iso, w] of Object.entries(daily)) {
    const monday = toISODay(mondayOf(parseDay(iso)));
    const acc = weeks[monday] ?? { sum: 0, n: 0 };
    acc.sum += w;
    acc.n += 1;
    weeks[monday] = acc;
  }
  const out: Record<string, number> = {};
  for (const [m, a] of Object.entries(weeks)) out[m] = a.sum / a.n;
  return out;
}

export function latestBodyweight(
  daily: Record<string, number>,
  weekly: Record<string, number>
): number | null {
  const dailyKeys = Object.keys(daily).sort();
  if (dailyKeys.length) return daily[dailyKeys[dailyKeys.length - 1]];
  const weekKeys = Object.keys(weekly).sort();
  if (weekKeys.length) return weekly[weekKeys[weekKeys.length - 1]];
  return null;
}

/** Average weekly lbs change over the last `weeks` completed weeks — telescoping
 *  difference between the most recent completed week and the one `weeks` before. */
export function fourWeekRate(
  weekly: Record<string, number>,
  today = new Date(),
  weeks = 4
): number | null {
  const currentMonday = toISODay(mondayOf(today));
  const available = Object.keys(weekly)
    .filter((m) => m < currentMonday)
    .sort();
  if (available.length < 2) return null;

  const span = Math.min(weeks, available.length - 1);
  const recent = available[available.length - 1];
  const past = available[available.length - 1 - span];
  const weeksElapsed =
    (parseDay(recent).getTime() - parseDay(past).getTime()) /
    (7 * 24 * 60 * 60 * 1000);
  return (weekly[recent] - weekly[past]) / weeksElapsed;
}

/** Acceptable weekly-rate band in lb/wk. The phase percentage (or range) is
 *  converted to lb and widened to tenths — e.g. a −0.82 lb/wk cut target
 *  accepts anything between −0.80 (back) and −0.90 (forward). */
export function targetRateLbs(
  phase: DietPhase,
  bodyweight: number
): [number, number] {
  const [lo, hi] = PHASE_TARGETS[phase];
  const min = Math.min(lo, hi) * bodyweight;
  const max = Math.max(lo, hi) * bodyweight;
  return [Math.floor(min * 10) / 10, Math.ceil(max * 10) / 10];
}

export type DietStatus = "on_track" | "too_slow" | "too_fast";

export function checkStatus(
  phase: DietPhase,
  bodyweight: number | null,
  actualRate: number | null
): DietStatus | null {
  if (actualRate === null || bodyweight === null) return null;
  const [min, max] = targetRateLbs(phase, bodyweight);
  if (phase === "cut") {
    if (actualRate > max) return "too_slow";
    if (actualRate < min) return "too_fast";
    return "on_track";
  }
  if (actualRate < min) return "too_slow";
  if (actualRate > max) return "too_fast";
  return "on_track";
}

export const REEVAL_MIN_WEEKS = 2;
export const REEVAL_MIN_DAYS = 14;

/** Completed weeks (Mon–Sun, before the current week) on/after the week of
 *  the last diet change — the only data valid for judging that change. */
export function weeksSinceChange(
  weekly: Record<string, number>,
  history: DietHistoryEntry[],
  today = new Date()
): string[] {
  if (!history.length) return [];
  const lastChange = history.map((h) => h.changed_on).sort().pop()!;
  const changeMonday = toISODay(mondayOf(parseDay(lastChange)));
  const currentMonday = toISODay(mondayOf(today));
  return Object.keys(weekly)
    .filter((m) => m >= changeMonday && m < currentMonday)
    .sort();
}

/** True while a diet change is too fresh to judge: at least 14 days must
 *  pass AND at least 2 completed weekly averages must exist on/after the
 *  change week before status/recommendation evaluate again. */
export function isPendingReevaluation(
  weekly: Record<string, number>,
  history: DietHistoryEntry[],
  today = new Date()
): boolean {
  if (!history.length) return false;
  const lastChange = history.map((h) => h.changed_on).sort().pop()!;
  const daysSince =
    (today.getTime() - parseDay(lastChange).getTime()) /
    (24 * 60 * 60 * 1000);
  if (daysSince < REEVAL_MIN_DAYS) return true;
  return weeksSinceChange(weekly, history, today).length < REEVAL_MIN_WEEKS;
}

function weekRate(
  weekly: Record<string, number>,
  weeks: string[],
  span: number
): number | null {
  if (weeks.length <= span) return null;
  const recent = weeks[weeks.length - 1];
  const past = weeks[weeks.length - 1 - span];
  const weeksElapsed =
    (parseDay(recent).getTime() - parseDay(past).getTime()) /
    (7 * 24 * 60 * 60 * 1000);
  return (weekly[recent] - weekly[past]) / weeksElapsed;
}

export interface RateSnapshot {
  w2: number | null;
  w3: number | null;
  w4: number | null;
  /** Median of the available 2/3/4-week rates — robust to single-week noise. */
  evaluation: number | null;
}

/** Trend measured only over post-change weeks: the 2, 3 and 4-week rates
 *  (whichever have enough data) plus their median for evaluation. */
export function ratesSinceChange(
  weekly: Record<string, number>,
  history: DietHistoryEntry[],
  today = new Date()
): RateSnapshot {
  const weeks = weeksSinceChange(weekly, history, today);
  const w2 = weekRate(weekly, weeks, 2);
  const w3 = weekRate(weekly, weeks, 3);
  const w4 = weekRate(weekly, weeks, 4);
  const avail = [w2, w3, w4].filter((v): v is number => v !== null).sort(
    (a, b) => a - b
  );
  let evaluation: number | null = null;
  if (avail.length) {
    evaluation =
      avail.length % 2
        ? avail[(avail.length - 1) / 2]
        : (avail[avail.length / 2 - 1] + avail[avail.length / 2]) / 2;
  }
  return { w2, w3, w4, evaluation };
}

/** Maintenance back-calculated from the observed trend at the given intake. */
export function estimateMaintenance(
  actualRate: number,
  currentIntake: number
): number {
  return currentIntake - actualRate * KCAL_PER_LB;
}

/** The intake actually in effect while the current trend was measured — latest
 *  history entry logged at or before the most recent *completed* weekly
 *  average's Sunday. The live (incomplete) current week never counts — a
 *  weekly average doesn't exist until the week finishes. */
export function intakeDuringTrend(
  history: DietHistoryEntry[],
  weekly: Record<string, number>,
  fallback: number,
  today = new Date()
): number {
  if (!history.length) return fallback;
  const currentMonday = toISODay(mondayOf(today));
  const completed = Object.keys(weekly)
    .filter((m) => m < currentMonday)
    .sort();
  if (!completed.length) return fallback;
  const cutoff = toISODay(addDays(parseDay(completed.pop()!), 6));
  const eligible = history.filter((h) => h.changed_on <= cutoff);
  if (!eligible.length) return fallback;
  return eligible.sort((a, b) => b.changed_on.localeCompare(a.changed_on))[0]
    .calorie_intake;
}

/** Maintenance estimate during a single history entry's active window:
 *  the entry's intake minus the weight trend measured over the completed
 *  weekly averages that happened while those targets were in effect.
 *  Returns null when the window has fewer than 2 completed weeks. */
export function entryMaintenance(
  weekly: Record<string, number>,
  history: DietHistoryEntry[],
  index: number,
  today = new Date()
): number | null {
  const h = history[index];
  if (!h) return null;
  const start = toISODay(mondayOf(parseDay(h.changed_on)));
  const end =
    index + 1 < history.length
      ? toISODay(mondayOf(parseDay(history[index + 1].changed_on)))
      : null;
  const currentMonday = toISODay(mondayOf(today));
  const weeks = Object.keys(weekly)
    .filter(
      (m) => m >= start && m < currentMonday && (end === null || m < end)
    )
    .sort();
  if (weeks.length < 2) return null;
  const weeksElapsed =
    (parseDay(weeks[weeks.length - 1]).getTime() -
      parseDay(weeks[0]).getTime()) /
    (7 * 24 * 60 * 60 * 1000);
  if (weeksElapsed <= 0) return null;
  const rate = (weekly[weeks[weeks.length - 1]] - weekly[weeks[0]]) / weeksElapsed;
  return h.calorie_intake - rate * KCAL_PER_LB;
}

export const CARB_MIN_SHARE = 0.35;
export const PROTEIN_MIN_PER_LB = 1;
export const FAT_MIN_PER_LB = 0.3;

export interface MacroPlan {
  protein_per_lb: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

/** Macro floor rules: protein ≥ 1 g/lb, fat ≥ 0.3 g/lb, carbs ≥ 35% of
 *  calories. When carbs fall below 35%, protein drops to the 1 g/lb floor
 *  first; if that's still not enough, fat is reduced toward its floor.
 *  `fatG` is the preferred value from Settings — it acts as the ceiling. */
export function enforceMacroFloors(
  calorieIntake: number,
  proteinPerLb: number,
  fatG: number,
  bodyweight: number
): MacroPlan {
  const minFat = FAT_MIN_PER_LB * bodyweight;
  let proteinPerLbAdj = Math.max(PROTEIN_MIN_PER_LB, proteinPerLb);
  let protein = proteinPerLbAdj * bodyweight;
  let fat = fatG;
  let carbs = Math.max(0, (calorieIntake - protein * 4 - fat * 9) / 4);
  const short = () =>
    calorieIntake > 0 && carbs * 4 < CARB_MIN_SHARE * calorieIntake;
  if (short() && proteinPerLbAdj > PROTEIN_MIN_PER_LB) {
    proteinPerLbAdj = PROTEIN_MIN_PER_LB;
    protein = bodyweight;
    carbs = Math.max(0, (calorieIntake - protein * 4 - fat * 9) / 4);
  }
  if (short()) {
    const fatCap = ((1 - CARB_MIN_SHARE) * calorieIntake - protein * 4) / 9;
    fat = Math.max(minFat, Math.min(fat, fatCap));
    carbs = Math.max(0, (calorieIntake - protein * 4 - fat * 9) / 4);
  }
  return {
    protein_per_lb: proteinPerLbAdj,
    protein_g: protein,
    fat_g: fat,
    carbs_g: carbs,
  };
}

export interface Recommendation {
  maintenance_estimate: number;
  calorie_intake: number;
  protein_per_lb: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export function recommend(
  settings: DietSettings,
  bodyweight: number,
  actualRate: number,
  intakeForTrend: number
): Recommendation {
  const [low, high] = targetRateLbs(settings.phase, bodyweight);
  const target = (low + high) / 2;
  const maintenance = estimateMaintenance(actualRate, intakeForTrend);
  const suggested = maintenance + target * KCAL_PER_LB;
  const plan = enforceMacroFloors(
    suggested,
    settings.protein_per_lb,
    settings.fat_g,
    bodyweight
  );
  return {
    maintenance_estimate: maintenance,
    calorie_intake: suggested,
    protein_per_lb: plan.protein_per_lb,
    protein_g: plan.protein_g,
    fat_g: plan.fat_g,
    carbs_g: plan.carbs_g,
  };
}
