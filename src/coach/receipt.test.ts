import { describe, it, expect } from "vitest";
import { buildReceipt, describeGap, RECEIPT_HEADING } from "./receipt.js";
import { parseGoals, cadenceStatus } from "./targets.js";
import { parseTasks } from "../vault/daily.js";
import type { Streak } from "../vault/daily.js";

const streak: Streak = { lastEntry: "2026-08-28", daysSinceLastEntry: 1, current: 4, longest: 11, total: 37 };

const GOALS = `## Identities
### I am someone who ships in public
- [ ] Publish a post \`weekly\` \`last:2026-08-01\` #goal/write
`;

const behind = cadenceStatus(parseGoals(GOALS).targets[0]!, [], "2026-08-29");

describe("describeGap", () => {
  it("is plain, with no softening", () => {
    expect(describeGap(null)).toBe("never");
    expect(describeGap(0)).toBe("today");
    expect(describeGap(1)).toBe("yesterday");
    expect(describeGap(9)).toBe("9 days ago");
  });
});

describe("buildReceipt", () => {
  it("renders counts and dates only", () => {
    const out = buildReceipt({
      streak,
      carried: parseTasks("- [ ] Draft the launch post (moved 6 days) #goal/write"),
      targets: [behind],
      ikigaiKan: { recent: 3.4, previous: 3.9, days: 14 },
    });
    expect(out).toMatchInlineSnapshot(`
      "## Where you are

      Last entry yesterday · streak 4 · longest 11 · 37 total
      ikigai-kan 3.4 over 14 days · previous 14 days 3.9

      Carried forward (1):
      - [ ] Draft the launch post #goal/write (moved 6 days)

      Missed twice (1):
      - Publish a post #goal/write — every week, 4 windows under, last 28 days ago
      "
    `);
  });

  it("says so plainly when there is nothing to report", () => {
    const out = buildReceipt({ streak, carried: [], targets: [] });
    expect(out).toContain("Nothing carried, nothing behind.");
  });

  it("marks a first entry without inventing a streak", () => {
    const fresh: Streak = { lastEntry: null, daysSinceLastEntry: null, current: 0, longest: 0, total: 0 };
    expect(buildReceipt({ streak: fresh, carried: [], targets: [] })).toContain("First entry.");
  });

  it("omits the ikigai-kan line entirely when there is no reading", () => {
    const out = buildReceipt({ streak, carried: [], targets: [], ikigaiKan: { recent: null, previous: null, days: 14 } });
    expect(out).not.toContain("ikigai-kan");
  });

  it("never uses evaluative language", () => {
    const out = buildReceipt({
      streak,
      carried: parseTasks("- [ ] A thing (moved 12 days)"),
      targets: [behind],
      ikigaiKan: { recent: 2.1, previous: 4.2, days: 14 },
    });
    // A receipt that praises or scolds is a receipt that gets argued with.
    const banned = [
      "great", "good", "nice", "well done", "keep it up", "unfortunately",
      "sadly", "impressive", "amazing", "proud", "don't worry", "you should",
      "try to", "remember to", "slipping", "falling behind", "!",
    ];
    for (const word of banned) expect(out.toLowerCase()).not.toContain(word);
  });

  it("starts with the heading, so the skill can print it verbatim", () => {
    expect(buildReceipt({ streak, carried: [], targets: [] }).startsWith(RECEIPT_HEADING)).toBe(true);
  });
});
