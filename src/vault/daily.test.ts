import { describe, it, expect } from "vitest";
import {
  parseTasks, formatTask, carryForwardTasks, parseDay, parseIkigaiKan,
  computeStreak, insertUnder, renderTemplate, sectionBody, ENTRY_HEADING,
} from "./daily.js";

const NOTE = `---
date: 2026-08-29
tags: [daily]
ikigai-kan: 4
---

# Saturday, August 29, 2026

## Entry

Rode the bike before anyone was up.

- [x] Ride the bike #goal/move
- [ ] Draft the launch post (moved 6 days) #goal/write

## The five-second moment

The gate latch stuck and I laughed instead of swearing.
`;

describe("parseTasks", () => {
  it("reads checkboxes, done state, age marker and goal tags", () => {
    const tasks = parseTasks(NOTE);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ done: true, movedDays: 0, goals: ["move"] });
    expect(tasks[1]).toMatchObject({ done: false, movedDays: 6, goals: ["write"] });
    // The age marker is stripped from the text so it never doubles up
    expect(tasks[1]!.text).toBe("Draft the launch post #goal/write");
  });

  it("skips an empty checkbox, which is a template placeholder", () => {
    expect(parseTasks("- [ ] \n- [ ]   ")).toHaveLength(0);
  });

  it("round-trips a task through formatTask without doubling the marker", () => {
    const [, carried] = parseTasks(NOTE);
    expect(formatTask(carried!)).toBe("- [ ] Draft the launch post #goal/write (moved 6 days)");
    expect(parseTasks(formatTask(carried!))[0]!.movedDays).toBe(6);
  });
});

describe("carryForwardTasks", () => {
  it("ages by the real gap, not by one", () => {
    const tasks = parseTasks(NOTE);
    const carried = carryForwardTasks(tasks, 3);
    expect(carried).toHaveLength(1);              // the done one is dropped
    expect(carried[0]!.movedDays).toBe(9);        // 6 + 3, not 7
  });

  it("treats a same-day or backwards gap as one day", () => {
    expect(carryForwardTasks(parseTasks("- [ ] a"), 0)[0]!.movedDays).toBe(1);
  });
});

describe("parseIkigaiKan", () => {
  it("accepts 1-5", () => {
    expect(parseIkigaiKan(4)).toBe(4);
    expect(parseIkigaiKan("2")).toBe(2);
  });

  it("returns null rather than coercing, so no trend is drawn from a guess", () => {
    for (const bad of [undefined, null, "", "  ", 0, 6, 3.5, "high", true, []]) {
      expect(parseIkigaiKan(bad)).toBeNull();
    }
  });
});

describe("parseDay", () => {
  it("splits entry, moment and ikigai-kan", () => {
    const day = parseDay("2026-08-29", "/x/2026-08-29.md", NOTE);
    expect(day.entry).toContain("Rode the bike");
    expect(day.entry).not.toContain("five-second");
    expect(day.moment).toBe("The gate latch stuck and I laughed instead of swearing.");
    expect(day.ikigaiKan).toBe(4);
  });

  it("reads an older note that capitalized the moment heading", () => {
    const old = NOTE.replace("## The five-second moment", "## The Five-Second Moment");
    expect(parseDay("2026-08-29", "x", old).moment).toContain("gate latch");
  });

  it("reports an empty entry as empty, so a scaffold never counts as a day", () => {
    const empty = "---\ndate: 2026-08-30\n---\n\n# x\n\n## Entry\n\n";
    const day = parseDay("2026-08-30", "x", empty);
    expect(day.entry).toBe("");
    expect(day.ikigaiKan).toBeNull();
  });
});

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    const s = computeStreak(["2026-08-27", "2026-08-28", "2026-08-29"], "2026-08-29");
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
    expect(s.total).toBe(3);
  });

  it("survives one missed day, so a late entry is not pointless", () => {
    expect(computeStreak(["2026-08-27", "2026-08-28"], "2026-08-29").current).toBe(2);
  });

  it("breaks after two missed days", () => {
    expect(computeStreak(["2026-08-27", "2026-08-28"], "2026-08-30").current).toBe(0);
  });

  it("remembers the longest run after a break", () => {
    const s = computeStreak(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-20"], "2026-08-20");
    expect(s.longest).toBe(3);
    expect(s.current).toBe(1);
  });

  it("reports the last entry before today and the gap", () => {
    const s = computeStreak(["2026-08-24", "2026-08-29"], "2026-08-29");
    expect(s.lastEntry).toBe("2026-08-24");
    expect(s.daysSinceLastEntry).toBe(5);
  });
});

describe("insertUnder", () => {
  it("appends inside Entry and leaves later sections intact", () => {
    const out = insertUnder(NOTE, ENTRY_HEADING, "Added from the desk.");
    expect(out).toContain("Added from the desk.");
    expect(out).toContain("The gate latch stuck");
    // The new text must land above the moment heading, not after it
    expect(out.indexOf("Added from the desk.")).toBeLessThan(out.indexOf("## The five-second moment"));
  });

  it("does not lose the existing entry when merging a phone note", () => {
    const out = insertUnder(NOTE, ENTRY_HEADING, "Second thought.");
    expect(out).toContain("Rode the bike before anyone was up.");
  });

  it("creates the section when the note has no Entry heading", () => {
    const out = insertUnder("---\ndate: x\n---\n\n# Title\n", ENTRY_HEADING, "words");
    expect(out).toContain("## Entry");
    expect(out).toContain("words");
  });
});

describe("renderTemplate", () => {
  it("fills date tokens", () => {
    const out = renderTemplate("date: {{date}}\n# {{date:dddd, MMMM D, YYYY}}", "2026-08-29");
    expect(out).toBe("date: 2026-08-29\n# Saturday, August 29, 2026");
  });
});

describe("sectionBody", () => {
  it("returns empty for a heading that is not there", () => {
    expect(sectionBody(NOTE, "## Nope")).toBe("");
  });
});
