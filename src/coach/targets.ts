// ---------------------------------------------------------------------------
// Goals.md — identities, targets, milestones.
//
// Targets are stamped by EVIDENCE, not by hand: a completed task carrying
// #goal/move stamps the target tagged #goal/move. Under-stamping is the safe
// failure, so an ambiguous tag stamps nothing and says so.
//
// Cadence is scored by counting days in the daily notes. There is no separate
// event log — the notes already record what happened, and a second store is a
// second thing to fall out of sync.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Cadence, Config, Day, Goals, Milestone, Target } from "../types.js";
import { vaultPath } from "../config.js";
import { daysBetween, todayKey, isDateKey } from "../vault/dates.js";
import { goalTags } from "../vault/daily.js";

const CHECKBOX = /^\s*[-*] \[([ xX])\]\s+(.*)$/;
const IDENTITY = /^###\s+(.*\S)\s*$/;
const H2 = /^##\s+(.*\S)\s*$/;
const SUB = /^\s+[-*]\s+(when|floor):\s*(.*\S)\s*$/;
const LAST = /`?\blast:(\d{4}-\d{2}-\d{2})`?/;
// Accepts both the bare form (`weekly`) and the older prefixed form
// (`cadence:weekly`), so a vault can migrate at its own pace instead of all at
// once. Backticks are optional because Obsidian users drop them.
const CADENCE = /`?\b(?:cadence:)?(daily|weekly|monthly|quarterly|\d+x-(?:weekly|monthly))\b`?/;

export function parseCadence(token: string | undefined): Cadence {
  if (!token) return { kind: "none" };
  const times = token.match(/^(\d+)x-(weekly|monthly)$/);
  if (times) {
    const count = Number(times[1]);
    if (count > 0) return { kind: "times", count, unit: times[2] === "weekly" ? "week" : "month" };
    return { kind: "none" };
  }
  switch (token) {
    case "daily": return { kind: "every", unit: "day" };
    case "weekly": return { kind: "every", unit: "week" };
    case "monthly": return { kind: "every", unit: "month" };
    case "quarterly": return { kind: "every", unit: "quarter" };
    default: return { kind: "none" };
  }
}

/** How many days one cadence window spans */
export function windowDays(cadence: Cadence): number {
  if (cadence.kind === "none") return 0;
  const unit = cadence.unit;
  return unit === "day" ? 1 : unit === "week" ? 7 : unit === "month" ? 30 : 91;
}

/** How many touches one window requires */
export function requiredTouches(cadence: Cadence): number {
  return cadence.kind === "times" ? cadence.count : cadence.kind === "every" ? 1 : 0;
}

export function formatCadence(cadence: Cadence): string {
  if (cadence.kind === "none") return "no cadence";
  if (cadence.kind === "times") return `${cadence.count}x per ${cadence.unit}`;
  return cadence.unit === "day" ? "daily" : `every ${cadence.unit}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function validDate(key: string | undefined): string | null {
  return key && isDateKey(key) ? key : null;
}

function firstGoal(text: string): string | null {
  return goalTags(text)[0] ?? null;
}

/**
 * Parse Goals.md.
 *
 * Lines inside HTML comments are skipped, which is what makes "## Parked" work:
 * a commented target stays in the file, keeps its history, and stops nagging.
 */
export function parseGoals(markdown: string): Goals {
  const targets: Target[] = [];
  const milestones: Milestone[] = [];

  let identity = "";
  let section = "";
  let commented = false;
  let current: Target | null = null;

  markdown.split("\n").forEach((original, index) => {
    let raw = original;
    // Strip an inline comment rather than discarding the line. Setting the flag
    // for the whole line threw away the text BEFORE "<!--", so a target with a
    // trailing note vanished from Goals.md with no diagnostic — unscored,
    // unstamped, and absent from the receipt.
    const startedCommented = commented;
    let line = raw;
    if (!commented) {
      const open = line.indexOf("<!--");
      if (open !== -1) {
        const close = line.indexOf("-->", open);
        line = close === -1 ? line.slice(0, open) : line.slice(0, open) + line.slice(close + 3);
        commented = close === -1;
      }
    } else {
      const close = line.indexOf("-->");
      if (close === -1) return;
      line = line.slice(close + 3);
      commented = false;
    }
    if (startedCommented && line.trim() === "") return;
    if (line.trim() === "") return;
    raw = line;

    const h2 = raw.match(H2);
    if (h2) {
      section = h2[1]!.toLowerCase();
      identity = "";
      current = null;
      return;
    }

    const h3 = raw.match(IDENTITY);
    if (h3) {
      identity = h3[1]!;
      current = null;
      return;
    }

    const sub = raw.match(SUB);
    if (sub && current) {
      if (sub[1] === "when") current.when = sub[2]!;
      else current.floor = sub[2]!;
      return;
    }

    const box = raw.match(CHECKBOX);
    if (!box) return;

    const body = box[2]!;
    const text = body
      .replace(CADENCE, "")
      .replace(LAST, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    // "## Not Yet" and "## Parked" hold things deliberately not being tracked.
    if (section.startsWith("not yet") || section.startsWith("parked")) {
      current = null;
      return;
    }

    if (section.startsWith("milestone")) {
      milestones.push({ text, goal: firstGoal(body), done: (box[1] ?? " ").toLowerCase() === "x" });
      current = null;
      return;
    }

    current = {
      text,
      identity,
      cadence: parseCadence(body.match(CADENCE)?.[1]),
      when: null,
      floor: null,
      goal: firstGoal(body),
      // Goals.md is hand-maintained, so a stamp like `last:2025-02-29` is a
      // natural typo. Treat an impossible date as no stamp rather than throwing
      // out of daysBetween and killing the whole command.
      last: validDate(body.match(LAST)?.[1]),
      line: index,
    };
    targets.push(current);
  });

  return { targets, milestones };
}

export function readGoals(config: Config): Goals {
  const path = vaultPath(config, "goals");
  if (!existsSync(path)) return { targets: [], milestones: [] };
  return parseGoals(readFileSync(path, "utf-8"));
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Distinct day keys on which a completed task carried this goal tag */
export function touchDays(days: Day[], goal: string): string[] {
  return days
    .filter((d) => d.tasks.some((t) => t.done && t.goals.includes(goal)))
    .map((d) => d.dateKey)
    .sort();
}

export interface CadenceStatus {
  target: Target;
  /** Touches in the trailing window (the last `windowDays` days, including today) */
  touchesThisWindow: number;
  required: number;
  /** Consecutive windows under target, counting back from now. See below. */
  consecutiveMisses: number;
  /** Days since the last touch, or null when never touched */
  daysSinceTouch: number | null;
  /** Windows the journal actually covers. Fewer windows means less is known. */
  windowsOfHistory: number;
}

/**
 * Score one target against the daily notes.
 *
 * Windows ROLL back from today rather than snapping to calendar weeks: the real
 * question for a habit is "three times in the last seven days", and a Monday
 * reset would let a target look met on Sunday and failed on Monday without
 * anything having changed.
 *
 * A window with no journal behind it is UNKNOWN, not missed. Counting those as
 * misses made a target added yesterday report eight straight failures, which is
 * the fastest way to teach someone to ignore the coach.
 */
export function cadenceStatus(
  target: Target,
  days: Day[],
  today: string = todayKey(),
): CadenceStatus {
  const required = requiredTouches(target.cadence);
  const span = windowDays(target.cadence);
  // The `last:` stamp is a touch too. Leaving it out of the window count made a
  // target stamped yesterday report as a dozen consecutive misses while the same
  // status object said "last touched yesterday" — visibly contradictory, and the
  // loud kind of wrong that teaches someone to stop reading the receipt.
  const touched = [
    ...new Set([...(target.goal ? touchDays(days, target.goal) : []), ...(target.last ? [target.last] : [])]),
  ].sort();
  const lastTouch = touched[touched.length - 1] ?? null;

  const base: CadenceStatus = {
    target,
    touchesThisWindow: 0,
    required,
    consecutiveMisses: 0,
    daysSinceTouch: lastTouch ? daysBetween(lastTouch, today) : null,
    windowsOfHistory: 0,
  };

  if (span === 0 || required === 0) return base;

  const inWindow = (index: number) =>
    touched.filter((d) => {
      const age = daysBetween(d, today);
      return age >= index * span && age < (index + 1) * span;
    }).length;

  // History reaches back to the earliest journal day OR the `last:` stamp,
  // whichever is older. The stamp is evidence too: a target last touched in
  // early August is known to have been missed since, even if the notes in the
  // window handed in do not reach that far back.
  const earliest = [days[0]?.dateKey, target.last]
    .filter((d): d is string => !!d)
    .sort()[0];
  const daysOfHistory = earliest ? daysBetween(earliest, today) + 1 : 0;
  base.windowsOfHistory = Math.max(0, Math.floor(daysOfHistory / span));
  base.touchesThisWindow = inWindow(0);

  let misses = 0;
  for (let i = 0; i < base.windowsOfHistory; i++) {
    if (inWindow(i) >= required) break;
    misses++;
  }
  base.consecutiveMisses = misses;

  return base;
}

/** Never miss twice: two completed windows missed in a row is the loud signal */
export const MISS_TWICE = 2;

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

export interface StampResult {
  stamped: string[];
  /** Tags matching more than one target. Under-stamping is the safe failure. */
  ambiguous: string[];
  markdown: string;
}

/**
 * Stamp `last:` on every target whose goal tag appears on a completed task.
 *
 * Idempotent per day: stamping twice writes the same date. A tag matching two
 * targets stamps neither, because guessing which one you meant would put a false
 * date in the file and nothing downstream could tell.
 */
export function stampTargets(markdown: string, goals: string[], today: string = todayKey()): StampResult {
  const parsed = parseGoals(markdown);
  const lines = markdown.split("\n");
  const stamped: string[] = [];
  const ambiguous: string[] = [];

  for (const goal of [...new Set(goals)]) {
    const matches = parsed.targets.filter((t) => t.goal === goal);
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      ambiguous.push(goal);
      continue;
    }

    const target = matches[0]!;
    const line = lines[target.line];
    if (line === undefined) continue;

    lines[target.line] = LAST.test(line)
      ? line.replace(LAST, `\`last:${today}\``)
      : line.replace(/(\s*)(#goal\/[\w-]+)/, ` \`last:${today}\`$1$2`);
    stamped.push(goal);
  }

  return { stamped, ambiguous, markdown: lines.join("\n") };
}

/** Stamp Goals.md in place from a day's completed tasks */
export function stampFromDay(config: Config, day: Day, today: string = todayKey()): StampResult {
  const path = vaultPath(config, "goals");
  const goals = day.tasks.filter((t) => t.done).flatMap((t) => t.goals);
  if (!existsSync(path) || goals.length === 0) {
    return { stamped: [], ambiguous: [], markdown: "" };
  }
  const result = stampTargets(readFileSync(path, "utf-8"), goals, today);
  if (result.stamped.length > 0) writeFileSync(path, result.markdown, "utf-8");
  return result;
}
