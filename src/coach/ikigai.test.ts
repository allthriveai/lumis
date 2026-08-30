import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PATHS } from "../config.js";
import type { Config } from "../types.js";
import {
  partitionByKan, scoredDays, kanTrend, parseSources, checkSources,
  starvedNeeds, needCoverage, parseRubric, intakeStatus, MIN_SCORED_DAYS,
} from "./ikigai.js";
import { parseDay } from "../vault/daily.js";
import { shiftDateKey } from "../vault/dates.js";
import type { Day } from "../types.js";
import type { NeedScores } from "./ikigai.js";

function day(dateKey: string, kan: number | null, body = ""): Day {
  const fm = kan === null ? "" : `ikigai-kan: ${kan}\n`;
  return parseDay(dateKey, `x/${dateKey}.md`, `---\ndate: ${dateKey}\n${fm}---\n\n## Entry\n\nwords\n\n${body}\n`);
}

/** n consecutive days ending at `end`, cycling through the given readings */
function history(end: string, n: number, readings: (number | null)[], body = ""): Day[] {
  const out: Day[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(day(shiftDateKey(end, -i), readings[(n - 1 - i) % readings.length] ?? null, body));
  }
  return out;
}

describe("the thin-window rule", () => {
  it("says nothing at all on five days — this is the safety property", () => {
    const p = partitionByKan(history("2026-08-30", 5, [1, 5, 2, 4, 3]));
    expect(p.insufficient).toBe(true);
    expect(p.high).toEqual([]);
    expect(p.low).toEqual([]);
    expect(p.scoredDayCount).toBe(5);
    expect(p.needed).toBe(MIN_SCORED_DAYS);
  });

  it("still refuses one day short of the threshold", () => {
    expect(partitionByKan(history("2026-08-30", MIN_SCORED_DAYS - 1, [3])).insufficient).toBe(true);
  });

  it("does not count unscored days toward the threshold", () => {
    // 90 days of journaling, but ikigai-kan was left blank on most of them.
    const days = history("2026-08-30", 90, [4, null, null, null, null]);
    const p = partitionByKan(days);
    expect(p.scoredDayCount).toBe(18);
    expect(p.insufficient).toBe(true);
  });

  it("partitions once there is enough", () => {
    const p = partitionByKan(history("2026-08-30", 90, [1, 2, 3, 4, 5]));
    expect(p.insufficient).toBe(false);
    expect(p.high).toHaveLength(9);
    expect(p.low).toHaveLength(9);
    expect(p.high.every((s) => s.value === 5)).toBe(true);
    expect(p.low.every((s) => s.value === 1)).toBe(true);
    expect(p.baseline).toBeCloseTo(3, 5);
  });

  it("hands back whole days, not summaries", () => {
    const days = history("2026-08-30", 90, [1, 5], "- [x] Ride #goal/move");
    const p = partitionByKan(days);
    expect(p.high[0]!.day.entry).toContain("words");
    expect(p.high[0]!.day.tasks[0]!.goals).toEqual(["move"]);
  });
});

describe("scoredDays", () => {
  it("drops unscored days rather than treating a blank as a zero", () => {
    expect(scoredDays(history("2026-08-30", 4, [3, null, 4, null]))).toHaveLength(2);
  });
});

describe("kanTrend", () => {
  it("compares the trailing window against the one before it", () => {
    const days = [...history("2026-08-16", 14, [2]), ...history("2026-08-30", 14, [4])];
    const t = kanTrend(days, "2026-08-30", 14);
    expect(t.recent).toBeCloseTo(4, 5);
    expect(t.previous).toBeCloseTo(2, 5);
  });

  it("returns null rather than zero when there are no readings", () => {
    expect(kanTrend([], "2026-08-30").recent).toBeNull();
  });
});

describe("parseSources", () => {
  const md = `# Ikigai

## Ikigai-kan

Some paragraph.

## Sources

- Building tools people actually use #goal/build
- Riding in the hills #goal/move
- Being a good friend

## The seven needs

- not a source
`;

  it("reads the list and its goal tags", () => {
    const sources = parseSources(md);
    expect(sources).toHaveLength(3);
    expect(sources[0]!.goal).toBe("build");
  });

  it("stops at the next heading", () => {
    expect(parseSources(md).some((s) => s.text.includes("not a source"))).toBe(false);
  });

  it("marks an untagged source, which is a claim nothing can check", () => {
    expect(parseSources(md)[2]!.goal).toBeNull();
  });
});

describe("checkSources", () => {
  const sources = parseSources("## Sources\n- Building #goal/build\n- Vibes\n");

  it("flags an untagged source as uncheckable rather than unmet", () => {
    const [, vibes] = checkSources(sources, history("2026-08-30", 90, [3]));
    expect(vibes!.uncheckable).toBe(true);
    expect(vibes!.insufficient).toBe(true);
  });

  it("reports insufficient rather than negative when a source was barely touched", () => {
    const days = history("2026-08-30", 90, [3]);
    days[0] = day(days[0]!.dateKey, 3, "- [x] Built #goal/build");
    const [build] = checkSources(sources, days);
    expect(build!.touchedDays).toHaveLength(1);
    expect(build!.insufficient).toBe(true);
  });

  it("compares against baseline once there is enough", () => {
    const days = history("2026-08-30", 90, [2]);
    for (let i = 0; i < 10; i++) days[i] = day(days[i]!.dateKey, 5, "- [x] Built #goal/build");
    const [build] = checkSources(sources, days);
    expect(build!.insufficient).toBe(false);
    expect(build!.meanOnTouchedDays).toBeCloseTo(5, 5);
    expect(build!.baseline!).toBeLessThan(build!.meanOnTouchedDays!);
  });

  it("ignores an intended-but-unfinished task", () => {
    const days = history("2026-08-30", 90, [3]);
    for (let i = 0; i < 10; i++) days[i] = day(days[i]!.dateKey, 5, "- [ ] Built #goal/build");
    expect(checkSources(sources, days)[0]!.touchedDays).toHaveLength(0);
  });
});

describe("the seven needs", () => {
  const history3: NeedScores[] = [
    { quarter: "2025-Q4", scores: { "life-satisfaction": 4, resonance: 2, freedom: 5 } },
    { quarter: "2026-Q1", scores: { "life-satisfaction": 4, resonance: 2, freedom: 4 } },
    { quarter: "2026-Q2", scores: { "life-satisfaction": 3, resonance: 2, freedom: 4 } },
  ];

  it("leads with the lowest need and carries its trend", () => {
    const starved = starvedNeeds(history3);
    expect(starved[0]!.need).toBe("resonance");
    expect(starved[0]!.trend).toEqual([2, 2, 2]);
  });

  it("skips needs never scored rather than treating them as zero", () => {
    expect(starvedNeeds(history3).map((n) => n.need)).not.toContain("bright-future");
  });

  it("returns nothing on an empty history", () => {
    expect(starvedNeeds([])).toEqual([]);
  });

  it("finds targets serving no need and needs served by no target", () => {
    const map = new Map([
      ["Ride the bike", ["life-satisfaction" as const]],
      ["Answer email", []],
    ]);
    const { unservedTargets, unservedNeeds } = needCoverage(map, ["Ride the bike", "Answer email"]);
    expect(unservedTargets).toEqual(["Answer email"]);
    expect(unservedNeeds).toContain("resonance");
    expect(unservedNeeds).not.toContain("life-satisfaction");
  });
});

describe("intake readiness", () => {
  const RUBRIC = `# Ikigai

## How I score ikigai-kan

- 1 — the Tuesday I could not get out of the chair
- 2 — heads down, nothing landed
- 3 — an ordinary working day
- 4 — the morning ride before the launch
- 5 — the day on the boat for mum's birthday

## Sources

- Building tools people use #goal/build
- Being a good friend
`;

  it("reads anchors written against numbers", () => {
    const anchors = parseRubric(RUBRIC);
    expect(anchors.size).toBe(5);
    expect(anchors.get(5)).toBe("the day on the boat for mum's birthday");
    expect(anchors.get(1)).toBe("the Tuesday I could not get out of the chair");
  });

  it("reports a partly filled scale as unusable rather than usable", () => {
    // A half-anchored scale is not comparable across months, which is the one
    // thing the evidence pass depends on.
    const partial = RUBRIC.replace("- 3 — an ordinary working day\n", "").replace("- 4 — the morning ride before the launch\n", "");
    expect(parseRubric(partial).size).toBe(3);
  });

  it("finds no anchors when the section is absent", () => {
    expect(parseRubric("# Ikigai\n\n## Sources\n\n- a thing #goal/x\n").size).toBe(0);
  });

  it("stops at the next heading", () => {
    expect(parseRubric(RUBRIC).size).toBe(5);
    expect([...parseRubric(RUBRIC).values()].some((v) => v.includes("goal/build"))).toBe(false);
  });
});

describe("the intake gate", () => {
  let vault: string;
  let config: Config;
  const write = (rel: string, body: string) => {
    const full = join(vault, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf-8");
  };

  const ANCHORS = "## How I score ikigai-kan\n\n- 1 — the Tuesday\n- 2 — heads down\n- 3 — ordinary\n- 4 — the ride\n- 5 — the boat day\n";
  const scoredVault = () => history("2026-08-30", 70, [1, 2, 3, 4, 5]);

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "lumis-intake-"));
    config = { vaultPath: vault, paths: { ...DEFAULT_PATHS } };
    mkdirSync(join(vault, "Life/Reviews"), { recursive: true });
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it("is not ready with no Ikigai.md at all", () => {
    expect(intakeStatus(config, []).ready).toBe(false);
  });

  it("is not ready on the shipped template, whose placeholders are inert", () => {
    // A live placeholder would report intake as done before a single real
    // source had been named, and sit in the evidence report forever at 0 touches.
    write("Lumis/Ikigai.md", readFileSync(join(process.cwd(), "templates/vault/Ikigai.md"), "utf-8"));
    const status = intakeStatus(config, []);
    expect(status.anchorsWritten).toBe(0);
    expect(status.sourcesCheckable).toBe(0);
    expect(status.ready).toBe(false);
  });

  it("is not ready on a partly anchored scale", () => {
    write("Lumis/Ikigai.md", "## How I score ikigai-kan\n\n- 1 — a\n- 2 — b\n\n## Sources\n\n- Building #goal/build\n");
    const status = intakeStatus(config, []);
    expect(status.hasRubric).toBe(false);
    expect(status.anchorsWritten).toBe(2);
    expect(status.ready).toBe(false);
  });

  it("is not ready when no source can be checked", () => {
    write("Lumis/Ikigai.md", `${ANCHORS}\n## Sources\n\n- Being a good friend\n`);
    const status = intakeStatus(config, []);
    expect(status.hasRubric).toBe(true);
    expect(status.sourcesTotal).toBe(1);
    expect(status.sourcesCheckable).toBe(0);
    expect(status.ready).toBe(false);
  });

  it("is ready with five anchors and one checkable source", () => {
    write("Lumis/Ikigai.md", `${ANCHORS}\n## Sources\n\n- Building #goal/build\n`);
    expect(intakeStatus(config, []).ready).toBe(true);
  });

  it("withholds the partition while the scale is unanchored, however many days there are", () => {
    // Announcing that the evidence pass cannot run and then running it anyway is
    // worse than not having the check at all.
    const p = partitionByKan(scoredVault(), false);
    expect(p.scoredDayCount).toBe(70);
    expect(p.insufficient).toBe(false);
    expect(p.ungrounded).toBe(true);
    expect(p.high).toEqual([]);
    expect(p.low).toEqual([]);
  });

  it("runs the partition once the scale is anchored", () => {
    const p = partitionByKan(scoredVault(), true);
    expect(p.ungrounded).toBe(false);
    expect(p.high).toHaveLength(7);
  });

  it("does not count a fenced or commented-out example as someone's scale", () => {
    write("Lumis/Ikigai.md", "# Ikigai\n\n```md\n" + ANCHORS + "```\n\n## Sources\n\n- Building #goal/build\n");
    expect(intakeStatus(config, []).anchorsWritten).toBe(0);

    write("Lumis/Ikigai.md", `<!--\n${ANCHORS}-->\n\n## Sources\n\n- Building #goal/build\n`);
    expect(intakeStatus(config, []).anchorsWritten).toBe(0);
  });

  it("accepts a plain numbered list, which is how people actually write a scale", () => {
    write("Lumis/Ikigai.md", "## How I score ikigai-kan\n\n1. the Tuesday\n2. heads down\n3. ordinary\n4. the ride\n5. the boat day\n\n## Sources\n\n- Building #goal/build\n");
    expect(intakeStatus(config, []).ready).toBe(true);
  });

  it("survives a directory named like a note on the daily path", () => {
    // intakeStatus runs inside `lumis today`, which the check-in skill runs every
    // morning. An unguarded read there took the whole command down.
    mkdirSync(join(vault, "Life/Reviews/Ikigai 2026-Q1.md"));
    mkdirSync(join(vault, "Lumis/Ikigai.md"), { recursive: true });
    expect(() => intakeStatus(config, [])).not.toThrow();
  });
});
