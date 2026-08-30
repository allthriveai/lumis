import { describe, it, expect } from "vitest";
import {
  parseTasks, formatTask, carryForwardTasks, parseDay, parseIkigaiKan,
  computeStreak, insertUnder, renderTemplate, sectionBody, ENTRY_HEADING,
} from "./daily.js";
import { isDateKey } from "./dates.js";

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

describe("free-hand capture must not alter what was written", () => {
  it("preserves apostrophes, quotes, blank lines and indentation", () => {
    const raw = "It's 6am and I can't settle.\n\nShe said \"just start\" and I didn't.\n\n  — trailing thought";
    const out = insertUnder("---\nd: 1\n---\n\n## Entry\n\n## The five-second moment\n", ENTRY_HEADING, raw);
    expect(out).toContain("It's 6am and I can't settle.");
    expect(out).toContain('She said "just start" and I didn\'t.');
    expect(out).toContain("  — trailing thought");
  });

  it("appends a second dump without eating the first", () => {
    const one = insertUnder("## Entry\n", ENTRY_HEADING, "First dump.");
    const two = insertUnder(one, ENTRY_HEADING, "Later. Still circling.");
    expect(two).toContain("First dump.");
    expect(two).toContain("Later. Still circling.");
    expect(two.indexOf("First dump.")).toBeLessThan(two.indexOf("Later."));
  });

  it("keeps free-hand writing above the moment heading", () => {
    const note = "## Entry\n\n## The five-second moment\n\nthe moment\n";
    const out = insertUnder(note, ENTRY_HEADING, "a long dump");
    expect(out.indexOf("a long dump")).toBeLessThan(out.indexOf("## The five-second moment"));
    expect(out).toContain("the moment");
  });
});

describe("the writer's own headings are content, not structure", () => {
  const note = "---\nd: 1\n---\n\n## Entry\n\nline one\n## a heading I typed myself\nsecond line\n\n## The five-second moment\n\nthe moment\n";

  it("appends after the writer's heading, not before it", () => {
    // Treating any "## " as a section boundary put a later capture ABOVE the
    // earlier writing and silently reordered the day.
    const out = insertUnder(note, ENTRY_HEADING, "Later that evening.");
    expect(out.indexOf("a heading I typed")).toBeLessThan(out.indexOf("Later that evening"));
    expect(out).toContain("## a heading I typed myself");
    expect(sectionBody(out, ENTRY_HEADING)).toContain("second line");
  });

  it("leaves the moment section alone", () => {
    expect(insertUnder(note, ENTRY_HEADING, "x")).toContain("## The five-second moment\n\nthe moment");
  });

  it("does not write inside a fenced code block", () => {
    const fenced = "## Entry\n\nsnippet:\n\n```md\n## Not a heading\n```\n\ntrailing\n";
    const out = insertUnder(fenced, ENTRY_HEADING, "APPENDED");
    expect(out).toContain("```md\n## Not a heading\n```");
    expect(out.indexOf("APPENDED")).toBeGreaterThan(out.indexOf("trailing"));
  });

  it("never rewrites the heading line it found", () => {
    // "## Entry" matched as a substring rewrote "## Entry — morning" to
    // "## Entry" and demoted "— morning" into the body.
    const out = insertUnder("---\nd: 1\n---\n\n## Entry — morning\n\nfirst thing\n", ENTRY_HEADING, "NEW");
    expect(out).toContain("## Entry — morning");
    // The old code rewrote the heading to a bare "## Entry" and demoted the
    // rest of it into the body, where it was indistinguishable from writing.
    expect(out.split("\n").filter((l) => l.trimEnd() === "## Entry")).toEqual([]);
    expect(out.trimEnd().endsWith("NEW")).toBe(true);
  });

  it("does not mistake a longer heading for the one it wants", () => {
    const out = insertUnder("## Entrypoints\n\nabout entrypoints\n\n## Entry\n\nreal entry\n", ENTRY_HEADING, "NEW");
    expect(out).toContain("## Entrypoints\n\nabout entrypoints");
    expect(out.indexOf("NEW")).toBeGreaterThan(out.indexOf("real entry"));
  });

  it("preserves leading whitespace in the file", () => {
    expect(insertUnder("## Entry\n", ENTRY_HEADING, "  indented\n\tand tabbed"))
      .toContain("  indented\n\tand tabbed");
  });
});

describe("computeStreak ignores the future", () => {
  it("does not let a future-dated note inflate longest or total", () => {
    // One written day in the past used to render "streak 1 · longest 4 · 5 total".
    const s = computeStreak(
      ["2026-08-30", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
      "2026-08-30",
    );
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
    expect(s.total).toBe(1);
  });
});

describe("an unterminated fence must not swallow the rest of the note", () => {
  const note = "---\nd: 1\n---\n\n## Entry\n\nMorning words.\n\n## The five-second moment\n\nThe gate latch stuck.\n";

  it("keeps the moment heading visible after an unclosed code fence", () => {
    // Letting an open fence run to EOF hid the moment heading: later captures
    // landed below it and the day was reported as never read.
    const withFence = insertUnder(note, ENTRY_HEADING, "The error:\n\n```js\nTypeError: x is not a function");
    const after = insertUnder(withFence, ENTRY_HEADING, "Evening: figured it out.");

    expect(sectionBody(after, /^##\s+The five-second moment\s*$/m)).toBe("The gate latch stuck.");
    expect(after.indexOf("Evening: figured it out.")).toBeLessThan(after.indexOf("## The five-second moment"));
  });

  it("still treats a properly closed fence as code", () => {
    const fenced = "## Entry\n\n```md\n## The five-second moment\n```\n\n## The five-second moment\n\nreal\n";
    const out = insertUnder(fenced, ENTRY_HEADING, "appended");
    expect(sectionBody(out, /^##\s+The five-second moment\s*$/m)).toBe("real");
    expect(out.indexOf("appended")).toBeLessThan(out.lastIndexOf("## The five-second moment"));
  });

  it("does not alter trailing spaces on the last line", () => {
    // Two trailing spaces is a markdown line break.
    expect(insertUnder("## Entry\n", ENTRY_HEADING, "a line  ")).toBe("## Entry\n\na line  \n");
  });
});

describe("a vault file with an impossible date is skipped, not fatal", () => {
  it("rejects a date-shaped key that is not a real date", () => {
    expect(isDateKey("2026-08-30")).toBe(true);
    expect(isDateKey("2025-02-29")).toBe(false);   // not a leap year
    expect(isDateKey("2026-09-31")).toBe(false);
    expect(isDateKey("nonsense")).toBe(false);
  });
});
