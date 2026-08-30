import { describe, it, expect } from "vitest";
import { computeDrift, STALE_TASK_DAYS } from "./drift.js";
import { parseDay } from "../vault/daily.js";
import { parseGoals } from "./targets.js";
import { shiftDateKey } from "../vault/dates.js";
import type { Day } from "../types.js";

function day(dateKey: string, entry: string, tasks = ""): Day {
  return parseDay(dateKey, "x", `---\ndate: ${dateKey}\n---\n\n## Entry\n\n${entry}\n\n${tasks}\n`);
}

const targets = parseGoals("## Identities\n### x\n- [ ] Publish `weekly` #goal/write\n").targets;

describe("computeDrift", () => {
  it("counts days with no file as silent", () => {
    const days = [day("2026-08-29", "words")];
    const drift = computeDrift(days, [], "2026-08-30", 7);
    expect(drift.silentDays).toHaveLength(6);
    expect(drift.silentDays).not.toContain("2026-08-29");
  });

  it("counts a scaffolded note with no words as silent", () => {
    const days = [day("2026-08-30", "")];
    expect(computeDrift(days, [], "2026-08-30", 1).silentDays).toEqual(["2026-08-30"]);
  });

  it("measures the longest run of silence, not just the total", () => {
    const days = ["2026-08-24", "2026-08-30"].map((d) => day(d, "words"));
    const drift = computeDrift(days, [], "2026-08-30", 7);
    expect(drift.silentDays).toHaveLength(5);
    expect(drift.longestSilence).toBe(5);
  });

  it("names a task only once it has been carried a week", () => {
    const fresh = [day("2026-08-30", "w", "- [ ] A thing (moved 6 days)")];
    expect(computeDrift(fresh, [], "2026-08-30", 30).staleTasks).toHaveLength(0);

    const stale = [day("2026-08-30", "w", `- [ ] A thing (moved ${STALE_TASK_DAYS} days)`)];
    expect(computeDrift(stale, [], "2026-08-30", 30).staleTasks).toHaveLength(1);
  });

  it("ignores a finished task however long it was carried", () => {
    const days = [day("2026-08-30", "w", "- [x] A thing (moved 40 days)")];
    expect(computeDrift(days, [], "2026-08-30", 30).staleTasks).toHaveLength(0);
  });

  it("separates missed-twice from merely behind", () => {
    const days: Day[] = [];
    let d = "2026-08-01";
    while (d <= "2026-08-08") { days.push(day(d, "words")); d = shiftDateKey(d, 1); }
    const oneMiss = computeDrift(days, targets, "2026-08-08", 30);
    expect(oneMiss.missedTwice).toHaveLength(0);
    expect(oneMiss.behind).toHaveLength(1);

    while (d <= "2026-08-15") { days.push(day(d, "words")); d = shiftDateKey(d, 1); }
    const twoMisses = computeDrift(days, targets, "2026-08-15", 30);
    expect(twoMisses.missedTwice).toHaveLength(1);
    expect(twoMisses.behind).toHaveLength(0);
  });
});
