// ---------------------------------------------------------------------------
// Drift — everything here is a count. Interpretation belongs to the skill.
//
// If a function in this file ever returns a sentence, it is in the wrong file.
// ---------------------------------------------------------------------------
import type { Day, Task } from "../types.js";
import { daysBetween, shiftDateKey, todayKey } from "../vault/dates.js";
import { cadenceStatus, MISS_TWICE, type CadenceStatus } from "./targets.js";
import type { Target } from "../types.js";

/** A carried task older than this is worth naming out loud */
export const STALE_TASK_DAYS = 7;
/** How far back the weekly view looks for silent stretches */
export const DEFAULT_WINDOW_DAYS = 30;

export interface Drift {
  /** Unfinished tasks carried longer than STALE_TASK_DAYS */
  staleTasks: { task: Task; dateKey: string }[];
  /** Days in the window with no note, or a note with no words */
  silentDays: string[];
  /** Longest run of consecutive silent days */
  longestSilence: number;
  /** Targets under cadence for two or more full windows */
  missedTwice: CadenceStatus[];
  /** Targets under cadence for exactly one window — reported, not shouted */
  behind: CadenceStatus[];
}

/**
 * Count what has slipped.
 *
 * Silent days are computed from the calendar rather than from the notes that
 * exist, because the interesting thing about a gap is the days with no file at
 * all — those are invisible to anything that iterates over the vault.
 */
export function computeDrift(
  days: Day[],
  targets: Target[],
  today: string = todayKey(),
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Drift {
  const from = shiftDateKey(today, -(windowDays - 1));
  const inWindow = days.filter((d) => d.dateKey >= from && d.dateKey <= today);

  const written = new Set(inWindow.filter((d) => d.entry.length > 0).map((d) => d.dateKey));
  const silentDays: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const key = shiftDateKey(from, i);
    if (!written.has(key)) silentDays.push(key);
  }

  let longestSilence = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of silentDays) {
    run = previous && daysBetween(previous, key) === 1 ? run + 1 : 1;
    if (run > longestSilence) longestSilence = run;
    previous = key;
  }

  const staleTasks = inWindow.flatMap((d) =>
    d.tasks
      .filter((t) => !t.done && t.movedDays >= STALE_TASK_DAYS)
      .map((task) => ({ task, dateKey: d.dateKey })),
  );

  const statuses = targets.map((t) => cadenceStatus(t, days, today));

  return {
    staleTasks,
    silentDays,
    longestSilence,
    missedTwice: statuses.filter((s) => s.consecutiveMisses >= MISS_TWICE),
    behind: statuses.filter(
      (s) => s.consecutiveMisses < MISS_TWICE && s.required > 0 && s.touchesThisWindow < s.required,
    ),
  };
}
