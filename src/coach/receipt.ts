// ---------------------------------------------------------------------------
// The receipt: the block that opens every session.
//
// It states where things stand BEFORE asking for anything, so nobody writes
// into a blank page. Facts only — no encouragement, no scolding, no recovery
// narrative. The skill interprets; this file counts.
//
// This is the anti-sycophancy surface, which is why it is pre-rendered here
// rather than described to the model. Prose generated fresh each morning drifts
// warmer over time; a rendered block does not.
// ---------------------------------------------------------------------------
import type { Task } from "../types.js";
import type { Streak } from "../vault/daily.js";
import type { CadenceStatus } from "./targets.js";
import { formatTask } from "../vault/daily.js";
import { formatCadence, MISS_TWICE } from "./targets.js";

export const RECEIPT_HEADING = "## Where you are";

/** "yesterday", "3 days ago" — plain, no softening */
export function describeGap(days: number | null): string {
  if (days === null) return "never";
  // A future date is a typo, not "today". A mistyped last: year reported a
  // target with no evidence behind it as touched today.
  if (days < 0) return `dated ${-days} days ahead`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export interface ReceiptInput {
  streak: Streak;
  carried: Task[];
  targets: CadenceStatus[];
  /** Mean ikigai-kan over the trailing window, and the window before it */
  ikigaiKan?: { recent: number | null; previous: number | null; days: number; readings?: number };
}

/**
 * Render the receipt.
 *
 * Every line is a count or a date. If a line could be read as praise or blame,
 * it does not belong here.
 */
export function buildReceipt({ streak, carried, targets, ikigaiKan }: ReceiptInput): string {
  const lines: string[] = [RECEIPT_HEADING, ""];

  lines.push(
    streak.lastEntry === null && streak.total === 0
      ? "First entry."
      : [
          `Last entry ${describeGap(streak.daysSinceLastEntry)}`,
          `streak ${streak.current}`,
          `longest ${streak.longest}`,
          `${streak.total} total`,
        ].join(" · "),
  );

  if (ikigaiKan && ikigaiKan.recent !== null) {
    const { recent, previous, days, readings } = ikigaiKan;
    const shift = previous === null ? "" : ` · previous ${days} days ${previous.toFixed(1)}`;
    // Say how many readings are behind the mean. "3.4 over 14 days" read as a
    // fortnight's data when it could be a single entry.
    const n = readings === undefined ? "" : ` from ${readings} reading${readings === 1 ? "" : "s"}`;
    lines.push(`ikigai-kan ${recent.toFixed(1)}${n} over ${days} days${shift}`);
  }

  lines.push("");

  if (carried.length > 0) {
    lines.push(`Carried forward (${carried.length}):`);
    for (const task of carried) lines.push(formatTask(task));
    lines.push("");
  }

  // Loud and quiet are separated because never-miss-twice is the signal and one
  // miss is noise. Collapsing them would make both easy to ignore.
  const loud = targets.filter((t) => t.consecutiveMisses >= MISS_TWICE);
  // windowsOfHistory > 0 is the same guard cadenceStatus applies to
  // consecutiveMisses. Without it here, a brand-new vault reported every target
  // as behind on day one — over-reporting, from a window with no journal
  // behind it at all.
  const quiet = targets.filter(
    (t) =>
      t.windowsOfHistory > 0 &&
      (t.consecutiveMisses === 1 || (t.required > 0 && t.touchesThisWindow < t.required)),
  );

  if (loud.length > 0) {
    lines.push(`Missed twice (${loud.length}):`);
    for (const t of loud) {
      lines.push(
        `- ${t.target.text} — ${formatCadence(t.target.cadence)}, ` +
          `${t.consecutiveMisses} windows under, last ${describeGap(t.daysSinceTouch)}`,
      );
    }
    lines.push("");
  }

  const quietOnly = quiet.filter((t) => !loud.includes(t));
  if (quietOnly.length > 0) {
    lines.push(`Behind this window (${quietOnly.length}):`);
    for (const t of quietOnly) {
      lines.push(
        `- ${t.target.text} — ${t.touchesThisWindow}/${t.required}, last ${describeGap(t.daysSinceTouch)}`,
      );
    }
    lines.push("");
  }

  if (carried.length === 0 && loud.length === 0 && quietOnly.length === 0) {
    lines.push("Nothing carried, nothing behind.", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}
