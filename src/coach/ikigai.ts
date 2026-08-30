// ---------------------------------------------------------------------------
// Ikigai — Kamiya, not the Venn diagram.
//
// The four-circle diagram is a 2011 Spanish purpose chart that was relabelled
// "ikigai" by a blogger in 2014. Mieko Kamiya's actual work separates ikigai
// (the sources) from ikigai-kan (the felt sense, which moves daily) and names
// seven needs behind it. This module works on that split.
//
// The code partitions and counts. It never names a source, never scores a need,
// and never concludes — that is the skill's job, done by reading the days this
// module hands it. A model that proposes your purpose is a model you cannot
// check.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config, Day, Need } from "../types.js";
import { SEVEN_NEEDS } from "../types.js";
import { vaultPath } from "../config.js";
import { parseFrontmatter } from "../vault/frontmatter.js";
import { goalTags, fencedLines, commentedLines } from "../vault/daily.js";
import { daysBetween, todayKey } from "../vault/dates.js";

/**
 * Days with an ikigai-kan reading below which the evidence pass says nothing.
 *
 * A confident reading off two weeks is exactly the failure this system exists to
 * avoid: it is the point where a coach starts telling you a story about yourself
 * that the data cannot support, and you have no way to tell.
 */
export const MIN_SCORED_DAYS = 60;

/** Smallest side of a partition worth reading */
const MIN_GROUP = 3;

export interface Scored {
  dateKey: string;
  value: number;
  day: Day;
}

/** Days that carry an ikigai-kan reading, ascending. Unscored days are dropped. */
export function scoredDays(days: Day[]): Scored[] {
  return days
    .filter((d): d is Day & { ikigaiKan: number } => d.ikigaiKan !== null)
    .map((d) => ({ dateKey: d.dateKey, value: d.ikigaiKan, day: d }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mean ikigai-kan over the trailing `window` days, and over the window before it */
export function kanTrend(
  days: Day[],
  today: string = todayKey(),
  window = 14,
): { recent: number | null; previous: number | null; days: number; readings: number } {
  const scored = scoredDays(days);
  const age = (s: Scored) => daysBetween(s.dateKey, today);
  const recentDays = scored.filter((s) => age(s) >= 0 && age(s) < window);
  return {
    recent: mean(recentDays.map((s) => s.value)),
    previous: mean(scored.filter((s) => age(s) >= window && age(s) < window * 2).map((s) => s.value)),
    days: window,
    readings: recentDays.length,
  };
}

export interface Partition {
  /** True when there is not enough scored history to say anything */
  insufficient: boolean;
  /**
   * True when the 1-5 scale has not been anchored, so the readings are not
   * comparable to each other. The partition is withheld either way — announcing
   * that the evidence pass cannot run and then running it is worse than not
   * having the check at all.
   */
  ungrounded: boolean;
  scoredDayCount: number;
  needed: number;
  baseline: number | null;
  high: Scored[];
  low: Scored[];
}

/**
 * Split the journal into the best and worst days by felt sense.
 *
 * This hands back the raw days — entries, moments, completed tasks — and nothing
 * else. No keyword extraction, no summary, no scoring of content. Reading two
 * sets of days and saying what differs is the half a model is actually good at;
 * deciding which days to read is the half it is not.
 */
export function partitionByKan(days: Day[], grounded = true): Partition {
  const scored = scoredDays(days);
  const values = scored.map((s) => s.value);
  const base: Partition = {
    insufficient: scored.length < MIN_SCORED_DAYS,
    ungrounded: !grounded,
    scoredDayCount: scored.length,
    needed: MIN_SCORED_DAYS,
    baseline: mean(values),
    high: [],
    low: [],
  };

  if (base.insufficient || base.ungrounded) return base;

  const size = Math.max(MIN_GROUP, Math.ceil(scored.length / 10));
  const byValue = [...scored].sort((a, b) => a.value - b.value || a.dateKey.localeCompare(b.dateKey));

  base.low = byValue.slice(0, size);
  base.high = byValue.slice(-size).reverse();
  return base;
}

// ---------------------------------------------------------------------------
// Ikigai.md
// ---------------------------------------------------------------------------

export interface Source {
  text: string;
  /** The #goal tag that makes this claim checkable */
  goal: string | null;
}

const SOURCES_HEADING = /^##\s+Sources\s*$/i;

/** Read the Sources list out of Ikigai.md */
export function parseSources(markdown: string): Source[] {
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  const commented = commentedLines(lines);
  const start = lines.findIndex((line, i) => !fenced[i] && !commented[i] && SOURCES_HEADING.test(line));
  if (start === -1) return [];

  const out: Source[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (fenced[i] || commented[i]) continue;
    if (/^##\s/.test(lines[i]!)) break;
    const text = lines[i]!.match(/^\s*[-*+]\s+(.*\S)\s*$/)?.[1];
    if (text) out.push({ text, goal: goalTags(text)[0] ?? null });
  }
  return out;
}

const RUBRIC_HEADING = /^##\s+How I score ikigai-kan\s*$/i;

/**
 * The 1-5 anchors, read out of Ikigai.md.
 *
 * Without these the daily number is uncalibrated: a 3 in August and a 3 in
 * November mean whatever the writer felt like that morning, and the evidence
 * pass is built entirely on comparing those numbers to each other. A scale
 * anchored to remembered days is reproducible; one anchored to adjectives
 * ("good", "fine") is not.
 */
/**
 * One anchor line. Accepts the ways people actually write a 1-5 scale:
 * "- 1 — text", "1. text", "1) text", "**1** - text", "1 = text", and the
 * Unicode minus. A plain numbered list is the most natural form of all and used
 * to parse as zero anchors, which read as "you have not done the work" to
 * someone who had.
 */
const ANCHOR = /^\s*(?:[-*+]\s+)?[*_]{0,2}([1-5])[*_]{0,2}\s*[—–\-−=:.)]\s+(.*\S)\s*$/;

export function parseRubric(markdown: string): Map<number, string> {
  const anchors = new Map<number, string>();
  const lines = markdown.split("\n");
  const fenced = fencedLines(lines);
  const commented = commentedLines(lines);

  // A fenced or commented-out example is not someone's scale. Same class as the
  // fence bug in daily.ts: without this, a documented example reads as anchored.
  const start = lines.findIndex((line, i) => !fenced[i] && !commented[i] && RUBRIC_HEADING.test(line));
  if (start === -1) return anchors;

  for (let i = start + 1; i < lines.length; i++) {
    if (fenced[i] || commented[i]) continue;
    if (/^##\s/.test(lines[i]!)) break;
    const match = lines[i]!.match(ANCHOR);
    if (match) anchors.set(Number(match[1]), match[2]!);
  }
  return anchors;
}

export interface IntakeStatus {
  /** All five anchors written down, so the daily number means something */
  hasRubric: boolean;
  anchorsWritten: number;
  sourcesTotal: number;
  /** Sources carrying a #goal tag, so the evidence check can count them */
  sourcesCheckable: number;
  quartersScored: number;
  scoredDays: number;
  /** Days still needed before the evidence pass can run */
  daysUntilEvidence: number;
  /** False means intake has not happened and the daily readings are ungrounded */
  ready: boolean;
}

export function intakeStatus(config: Config, days: Day[]): IntakeStatus {
  const markdown = readIfFile(vaultPath(config, "ikigai"));
  const rubric = parseRubric(markdown);
  const sources = parseSources(markdown);
  const quarters = readNeedHistory(config).filter((q) => Object.keys(q.scores).length > 0);
  const scored = scoredDays(days).length;

  // Derived once. Computing `rubric.size === 5` separately for hasRubric and
  // for ready meant the two could drift apart, and a mutation to one left the
  // other — and every test — untouched.
  const hasRubric = rubric.size === 5;
  const sourcesCheckable = sources.filter((s) => s.goal).length;

  return {
    hasRubric,
    anchorsWritten: rubric.size,
    sourcesTotal: sources.length,
    sourcesCheckable,
    quartersScored: quarters.length,
    scoredDays: scored,
    daysUntilEvidence: Math.max(0, MIN_SCORED_DAYS - scored),
    ready: hasRubric && sourcesCheckable > 0,
  };
}

export function readSources(config: Config): Source[] {
  return parseSources(readIfFile(vaultPath(config, "ikigai")));
}

/**
 * Read a vault file, or "" if it is missing or unreadable.
 *
 * intakeStatus put Ikigai.md and every Life/Reviews file on the `today` path,
 * which the check-in skill runs every morning. A directory named like a note
 * threw EISDIR and took the command down — the untrusted-input rule arriving
 * one commit late again.
 */
function readIfFile(path: string): string {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf-8") : "";
  } catch {
    return "";
  }
}

export interface SourceEvidence {
  source: Source;
  /** Days in the window on which a completed task carried this source's tag */
  touchedDays: string[];
  /** Mean ikigai-kan on those days */
  meanOnTouchedDays: number | null;
  /** Mean across every scored day in the window */
  baseline: number | null;
  /** True when there is too little to compare. Never reported as a negative finding. */
  insufficient: boolean;
  /** Set when the source carries no #goal tag, so nothing can be counted */
  uncheckable: boolean;
}

/**
 * Check each claimed source against the log.
 *
 * Under-claiming is the safe failure. A source touched twice in ninety days
 * reports as insufficient, not as disproved — the honest reading of two data
 * points is that you have two data points.
 */
export function checkSources(sources: Source[], days: Day[]): SourceEvidence[] {
  const scored = scoredDays(days);
  const baseline = mean(scored.map((s) => s.value));

  return sources.map((source) => {
    if (!source.goal) {
      return {
        source, touchedDays: [], meanOnTouchedDays: null, baseline,
        insufficient: true, uncheckable: true,
      };
    }

    const touched = scored.filter((s) =>
      s.day.tasks.some((t) => t.done && t.goals.includes(source.goal!)),
    );

    return {
      source,
      touchedDays: touched.map((s) => s.dateKey),
      meanOnTouchedDays: mean(touched.map((s) => s.value)),
      baseline,
      insufficient: touched.length < MIN_GROUP || scored.length < MIN_SCORED_DAYS,
      uncheckable: false,
    };
  });
}

// ---------------------------------------------------------------------------
// The seven needs
// ---------------------------------------------------------------------------

export interface NeedScores {
  quarter: string;
  scores: Partial<Record<Need, number>>;
}

const QUARTER_FILE = /^Ikigai (\d{4})-Q([1-4])\.md$/;

/**
 * Read every quarterly need-scoring note, oldest first.
 *
 * Scores live in review notes rather than in Ikigai.md so that the definitions
 * stay a definition and the scores stay seven time series. A single number is
 * not a finding; a need sitting at 2 for three quarters is.
 */
export function readNeedHistory(config: Config): NeedScores[] {
  const dir = vaultPath(config, "reviews");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .map((file) => ({ file, match: file.match(QUARTER_FILE) }))
    .filter((f): f is { file: string; match: RegExpMatchArray } => f.match !== null)
    .map(({ file, match }) => {
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(readIfFile(join(dir, file)));
      const scores: Partial<Record<Need, number>> = {};
      for (const need of SEVEN_NEEDS) {
        const raw = frontmatter[need];
        const value = typeof raw === "number" ? raw : Number(raw);
        if (Number.isInteger(value) && value >= 1 && value <= 5) scores[need] = value;
      }
      return { quarter: `${match[1]}-Q${match[2]}`, scores };
    })
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** The lowest-scoring needs in the latest quarter. Leads the report. */
export function starvedNeeds(history: NeedScores[]): { need: Need; score: number; trend: number[] }[] {
  const latest = history[history.length - 1];
  if (!latest) return [];

  return SEVEN_NEEDS.map((need) => ({
    need,
    score: latest.scores[need] ?? NaN,
    trend: history.map((h) => h.scores[need]).filter((v): v is number => v !== undefined),
  }))
    .filter((n) => !Number.isNaN(n.score))
    .sort((a, b) => a.score - b.score);
}

/**
 * Targets serving no need, and needs served by no target.
 *
 * Both directions matter. The first finds work carried by momentum; the second
 * finds the hole nothing in Goals.md is pointed at.
 */
export function needCoverage(
  needsByTarget: Map<string, Need[]>,
  targets: string[],
): { unservedTargets: string[]; unservedNeeds: Need[] } {
  const served = new Set<Need>();
  for (const needs of needsByTarget.values()) for (const n of needs) served.add(n);

  return {
    unservedTargets: targets.filter((t) => (needsByTarget.get(t) ?? []).length === 0),
    unservedNeeds: SEVEN_NEEDS.filter((n) => !served.has(n)),
  };
}
