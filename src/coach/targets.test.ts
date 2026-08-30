import { describe, it, expect } from "vitest";
import { parseGoals, parseCadence, cadenceStatus, stampTargets, touchDays, formatCadence } from "./targets.js";
import { parseDay } from "../vault/daily.js";
import { shiftDateKey } from "../vault/dates.js";
import type { Day } from "../types.js";

const GOALS = `# Goals

## Identities

### I am someone who moves every day
- [ ] Ride the bike \`3x-weekly\` \`last:2026-08-28\` #goal/move
  - when: after morning coffee, on the trainer
  - floor: 10 minutes

### I am someone who ships in public
- [ ] Publish a post \`weekly\` \`last:2026-08-21\` #goal/write
  - when: Sunday morning before anyone's up
  - floor: one paragraph, posted
- [ ] Artist date \`weekly\` #goal/artist-date
  - when: Friday afternoon. Alone, for fun.

## Milestones
- [ ] Three paying clients #goal/business
- [x] Ship the first version #goal/build

## Parked
<!-- - [ ] Learn Japanese \`weekly\` #goal/learn -->
`;

function day(dateKey: string, tasks: string): Day {
  return parseDay(dateKey, `x/${dateKey}.md`, `---\ndate: ${dateKey}\n---\n\n## Entry\n\nwords\n\n${tasks}\n`);
}

describe("parseGoals", () => {
  const goals = parseGoals(GOALS);

  it("attaches each target to the identity heading above it", () => {
    expect(goals.targets.map((t) => t.identity)).toEqual([
      "I am someone who moves every day",
      "I am someone who ships in public",
      "I am someone who ships in public",
    ]);
  });

  it("reads cadence, last, goal tag, when and floor", () => {
    const bike = goals.targets[0]!;
    expect(bike.cadence).toEqual({ kind: "times", count: 3, unit: "week" });
    expect(bike.last).toBe("2026-08-28");
    expect(bike.goal).toBe("move");
    expect(bike.when).toBe("after morning coffee, on the trainer");
    expect(bike.floor).toBe("10 minutes");
  });

  it("strips the metadata out of the target text", () => {
    expect(goals.targets[0]!.text).toBe("Ride the bike #goal/move");
  });

  it("leaves last null on a target never stamped", () => {
    expect(goals.targets[2]!.last).toBeNull();
  });

  it("keeps milestones out of targets so they never nag", () => {
    expect(goals.targets).toHaveLength(3);
    expect(goals.milestones).toHaveLength(2);
    expect(goals.milestones[1]).toMatchObject({ done: true, goal: "build" });
  });

  it("skips parked targets inside HTML comments", () => {
    expect(GOALS).toContain("Learn Japanese");
    expect(goals.targets.some((t) => t.text.includes("Japanese"))).toBe(false);
  });
});

describe("parseCadence", () => {
  it("reads the forms that appear in the file", () => {
    expect(parseCadence("daily")).toEqual({ kind: "every", unit: "day" });
    expect(parseCadence("quarterly")).toEqual({ kind: "every", unit: "quarter" });
    expect(parseCadence("3x-weekly")).toEqual({ kind: "times", count: 3, unit: "week" });
  });

  it("treats anything unrecognised as no cadence rather than guessing", () => {
    expect(parseCadence(undefined).kind).toBe("none");
    expect(parseCadence("sometimes").kind).toBe("none");
    expect(parseCadence("0x-weekly").kind).toBe("none");
  });

  it("formats for display", () => {
    expect(formatCadence(parseCadence("3x-weekly"))).toBe("3x per week");
    expect(formatCadence(parseCadence("weekly"))).toBe("every week");
  });
});

describe("cadence scored from the daily notes", () => {
  // Unstamped, so these tests measure journal evidence only. The `last:` stamp
  // is separate evidence and is covered in its own block below.
  const bike = parseGoals(GOALS.replace(" `last:2026-08-28`", "")).targets[0]!;

  it("counts distinct days, so closing the same day twice cannot satisfy 3x", () => {
    const twiceInOneDay = [day("2026-08-29", "- [x] Ride #goal/move\n- [x] Ride again #goal/move")];
    expect(touchDays(twiceInOneDay, "move")).toEqual(["2026-08-29"]);
    expect(cadenceStatus(bike, twiceInOneDay, "2026-08-29").touchesThisWindow).toBe(1);
  });

  it("counts touches in the trailing window", () => {
    const days = ["2026-08-25", "2026-08-27", "2026-08-29"].map((d) => day(d, "- [x] Ride #goal/move"));
    const status = cadenceStatus(bike, days, "2026-08-29");
    expect(status.touchesThisWindow).toBe(3);
    expect(status.required).toBe(3);
    expect(status.consecutiveMisses).toBe(0);
  });

  it("rolls the window back from today rather than snapping to calendar weeks", () => {
    // Three rides spread across a Sunday/Monday boundary still count as one week.
    const days = ["2026-08-23", "2026-08-24", "2026-08-26"].map((d) => day(d, "- [x] Ride #goal/move"));
    expect(cadenceStatus(bike, days, "2026-08-29").touchesThisWindow).toBe(3);
  });

  it("treats a window with no journal behind it as unknown, not missed", () => {
    // One day of history. A target added yesterday must not report a pile of misses.
    const days = [day("2026-08-29", "- [x] Something else #goal/other")];
    const status = cadenceStatus(bike, days, "2026-08-29");
    expect(status.windowsOfHistory).toBe(0);
    expect(status.consecutiveMisses).toBe(0);
  });

  it("fires never-miss-twice only after two full windows under target", () => {
    const post = parseGoals(GOALS).targets[1]!;   // weekly, #goal/write
    const history = (last: string) => {
      const out = [day("2026-08-01", "- [x] Publish #goal/write")];
      let d = "2026-08-02";
      while (d <= last) { out.push(day(d, "- [ ] nothing")); d = shiftDateKey(d, 1); }
      return out;
    };
    // One empty week since the last post: a single miss, which stays quiet.
    expect(cadenceStatus(post, history("2026-08-08"), "2026-08-08").consecutiveMisses).toBe(1);
    // Two empty weeks: this is the loud one.
    expect(cadenceStatus(post, history("2026-08-15"), "2026-08-15").consecutiveMisses).toBe(2);
  });

  it("reports days since the most recent touch", () => {
    expect(cadenceStatus(bike, [day("2026-08-24", "- [x] Ride #goal/move")], "2026-08-29").daysSinceTouch).toBe(5);
    expect(cadenceStatus(bike, [day("2026-08-29", "- [x] Ride #goal/move")], "2026-08-29").daysSinceTouch).toBe(0);
  });

  it("ignores an unchecked task — intending is not evidence", () => {
    const days = [day("2026-08-29", "- [ ] Ride #goal/move")];
    expect(cadenceStatus(bike, days, "2026-08-29").touchesThisWindow).toBe(0);
  });
});

describe("stampTargets", () => {
  it("stamps by evidence and is idempotent per day", () => {
    const once = stampTargets(GOALS, ["move"], "2026-08-29");
    expect(once.stamped).toEqual(["move"]);
    expect(once.markdown).toContain("`last:2026-08-29`");
    const twice = stampTargets(once.markdown, ["move"], "2026-08-29");
    expect(twice.markdown).toBe(once.markdown);
  });

  it("adds last: to a target that has never been stamped", () => {
    const out = stampTargets(GOALS, ["artist-date"], "2026-08-29");
    expect(out.stamped).toEqual(["artist-date"]);
    expect(out.markdown).toContain("Artist date `weekly` `last:2026-08-29` #goal/artist-date");
  });

  it("stamps nothing when a tag matches two targets, and says which", () => {
    const dup = GOALS.replace("#goal/artist-date", "#goal/write");
    const out = stampTargets(dup, ["write"], "2026-08-29");
    expect(out.stamped).toEqual([]);
    expect(out.ambiguous).toEqual(["write"]);
    expect(out.markdown).toBe(dup);
  });

  it("ignores a tag with no target", () => {
    const out = stampTargets(GOALS, ["nonexistent"], "2026-08-29");
    expect(out.stamped).toEqual([]);
    expect(out.markdown).toBe(GOALS);
  });

  it("does not stamp a parked target", () => {
    const out = stampTargets(GOALS, ["learn"], "2026-08-29");
    expect(out.stamped).toEqual([]);
    expect(out.markdown).toBe(GOALS);
  });
});

describe("older Goals.md formats still parse", () => {
  // The vault should migrate when its owner wants to, not when the parser does.
  const legacy = `# Goals

## Active Targets
- [ ] Ride the bike \`cadence:3x-weekly\` \`last:2026-08-29\` #goal/bike
- [ ] Morning pages \`cadence:daily\` #goal/morning

## Not Yet
- [ ] Learn Spanish \`cadence:weekly\` #goal/spanish
`;

  it("reads the cadence: prefix and a flat target list with no identity", () => {
    const { targets } = parseGoals(legacy);
    expect(targets).toHaveLength(2);
    expect(targets[0]!.cadence).toEqual({ kind: "times", count: 3, unit: "week" });
    expect(targets[0]!.last).toBe("2026-08-29");
    expect(targets[0]!.identity).toBe("");
    expect(targets[1]!.cadence).toEqual({ kind: "every", unit: "day" });
  });

  it("leaves 'Not Yet' out, the same as Parked", () => {
    expect(parseGoals(legacy).targets.some((t) => t.text.includes("Spanish"))).toBe(false);
  });

  it("strips the prefixed cadence out of the target text", () => {
    expect(parseGoals(legacy).targets[0]!.text).toBe("Ride the bike #goal/bike");
  });
});

describe("the last: stamp counts as a touch", () => {
  const daily = parseGoals("## Identities\n### x\n- [ ] Journal `daily` `last:2026-08-29` #goal/journal\n").targets[0]!;

  it("does not call a target stamped yesterday a pile of misses", () => {
    const days = ["2026-08-19", "2026-08-29"].map((d) =>
      parseDay(d, "x", `---\ndate: ${d}\n---\n\n## Entry\n\nwords\n`));
    const status = cadenceStatus(daily, days, "2026-08-30");
    expect(status.daysSinceTouch).toBe(1);
    expect(status.consecutiveMisses).toBe(1);   // today only
  });

  it("stays consistent: never reports misses while claiming a touch today", () => {
    const today = parseGoals("### x\n- [ ] Journal `daily` `last:2026-08-30` #goal/journal\n").targets[0]!;
    const status = cadenceStatus(today, [], "2026-08-30");
    expect(status.daysSinceTouch).toBe(0);
    expect(status.consecutiveMisses).toBe(0);
  });
});

describe("stamp evidence and journal evidence together", () => {
  const stamped = parseGoals(GOALS).targets[0]!;   // 3x-weekly, last:2026-08-28

  it("counts a stamped date the journal has no note for", () => {
    // Nothing was written on the 28th, so the stamp is the only record of it.
    const days = ["2026-08-25", "2026-08-27"].map((d) => day(d, "- [x] Ride #goal/move"));
    expect(cadenceStatus(stamped, days, "2026-08-29").touchesThisWindow).toBe(3);
  });

  it("does not double-count a date both sources agree on", () => {
    const days = [day("2026-08-28", "- [x] Ride #goal/move")];
    expect(cadenceStatus(stamped, days, "2026-08-29").touchesThisWindow).toBe(1);
  });
});
