// ---------------------------------------------------------------------------
// Daily notes. The file is the database — there is no index and no state file.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Config, Day, Task } from "../types.js";
import { vaultPath } from "../config.js";
import { parseFrontmatter } from "./frontmatter.js";
import { parseDateKey, toDateKey, formatDate, daysBetween, todayKey } from "./dates.js";

const TASK_LINE = /^(\s*)[-*] \[([ xX])\]\s+(.*)$/;
// Unanchored on purpose: formatTask writes the marker last, but a hand-written
// line may put the #goal tag after it. Anchoring to end-of-line made those parse
// as age 0, which silently re-aged the task from zero every single day.
const AGE_MARKER = /\s*\(moved (\d+) days?\)/;

/**
 * The one definition of a #goal tag, shared with targets.ts so the two parsers
 * cannot drift. Exposed as a function rather than a shared /g regex on purpose:
 * a module-level global regex carries `lastIndex` between callers, so an exec()
 * in one parser made the next matchAll() start mid-string and silently find no
 * tags at all.
 */
const GOAL_TAG_SOURCE = String.raw`#goal\/([\w-]+)`;

/** Every #goal/* tag in a line, without the prefix */
export function goalTags(text: string): string[] {
  return [...text.matchAll(new RegExp(GOAL_TAG_SOURCE, "g"))].map((m) => m[1]).filter((g): g is string => !!g);
}

export const ENTRY_HEADING = "## Entry";
/** Homework for Life. Matched case-insensitively — older notes capitalized it. */
const MOMENT_RE = /^##\s+The [Ff]ive-[Ss]econd [Mm]oment\s*$/m;
export const MOMENT_HEADING = "## The five-second moment";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Extract every markdown checkbox from a note */
export function parseTasks(content: string): Task[] {
  const tasks: Task[] = [];

  for (const raw of content.split("\n")) {
    const match = raw.match(TASK_LINE);
    if (!match) continue;

    const checkbox = match[2] ?? " ";
    const body = match[3] ?? "";
    const ageMatch = body.match(AGE_MARKER);
    const text = body.replace(AGE_MARKER, "").trim();

    // An empty checkbox is a template placeholder, not a task
    if (!text) continue;

    tasks.push({
      text,
      done: checkbox.toLowerCase() === "x",
      movedDays: ageMatch?.[1] ? Number(ageMatch[1]) : 0,
      goals: goalTags(text),
    });
  }

  return tasks;
}

/** Render a task back to a markdown checkbox line */
export function formatTask(task: Task): string {
  const box = task.done ? "x" : " ";
  const days = task.movedDays;
  const marker = days > 0 ? ` (moved ${days} day${days === 1 ? "" : "s"})` : "";
  return `- [${box}] ${task.text}${marker}`;
}

/**
 * Carry unfinished tasks into a new day, aging each by the days that actually
 * passed. A task that sat through a three-day gap reads as three days older,
 * not one — the count is the whole point.
 */
export function carryForwardTasks(tasks: Task[], gapDays: number): Task[] {
  const gap = Math.max(1, gapDays);
  return tasks.filter((t) => !t.done).map((t) => ({ ...t, movedDays: t.movedDays + gap }));
}

/** The body under a "## " heading, up to the next one. Empty when absent. */
export function sectionBody(content: string, heading: string | RegExp): string {
  const match = typeof heading === "string" ? content.indexOf(heading) : content.search(heading);
  if (match === -1) return "";
  const headingLength =
    typeof heading === "string"
      ? heading.length
      : (content.slice(match).match(/^.*$/m)?.[0].length ?? 0);
  const rest = content.slice(match + headingLength);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/**
 * ikigai-kan is a 1-5 integer in frontmatter. Anything else — blank, a word, out
 * of range — reads as null. Never coerced, never guessed: a wrong number here
 * silently poisons every trend the ikigai skill draws.
 */
export function parseIkigaiKan(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

/** Parse a daily note's markdown into a Day */
export function parseDay(dateKey: string, path: string, markdown: string): Day {
  const { frontmatter, content } = parseFrontmatter<Record<string, unknown>>(markdown);
  return {
    dateKey,
    path,
    entry: sectionBody(content, ENTRY_HEADING),
    moment: sectionBody(content, MOMENT_RE),
    ikigaiKan: parseIkigaiKan(frontmatter["ikigai-kan"]),
    tasks: parseTasks(content),
  };
}

// ---------------------------------------------------------------------------
// Reading the vault
// ---------------------------------------------------------------------------

function notePath(config: Config, dateKey: string): string {
  const name = formatDate(parseDateKey(dateKey), config.paths.dailyNoteFormat);
  return join(vaultPath(config, "dailyNotes"), `${name}.md`);
}

/** Every date key that has a daily note, ascending */
export function listDayKeys(config: Config): string[] {
  const dir = vaultPath(config, "dailyNotes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
}

/** Read one day, or null when the note does not exist */
export function readDay(config: Config, dateKey: string): Day | null {
  const path = notePath(config, dateKey);
  if (!existsSync(path)) return null;
  return parseDay(dateKey, path, readFileSync(path, "utf-8"));
}

/** Read every day in [from, to] that exists, ascending */
export function readDays(config: Config, from: string, to: string): Day[] {
  return listDayKeys(config)
    .filter((k) => k >= from && k <= to)
    .map((k) => readDay(config, k))
    .filter((d): d is Day => d !== null);
}

/**
 * Days with words in the Entry but no five-second moment yet. This is how a desk
 * session finds what was typed on the phone — by reading files, with no cursor
 * and no state to fall out of sync.
 */
export function unanalyzedDays(config: Config): Day[] {
  return listDayKeys(config)
    .map((k) => readDay(config, k))
    .filter((d): d is Day => d !== null && d.entry.length > 0 && d.moment.length === 0);
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface Streak {
  lastEntry: string | null;
  daysSinceLastEntry: number | null;
  current: number;
  longest: number;
  total: number;
}

/**
 * The current streak counts consecutive days ending today or yesterday — one
 * missed day does not erase it until the day after, which keeps a late entry
 * from feeling pointless.
 *
 * Counts only days that were actually written in. An empty scaffolded note is
 * not a journaling day, which is why nothing here ever creates one.
 */
export function computeStreak(dates: string[], today: string = todayKey()): Streak {
  const sorted = [...new Set(dates)].sort();
  const past = sorted.filter((d) => d <= today);

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = date;
  }

  let current = 0;
  const mostRecent = past[past.length - 1];
  if (mostRecent && daysBetween(mostRecent, today) <= 1) {
    current = 1;
    for (let i = past.length - 2; i >= 0; i--) {
      if (daysBetween(past[i]!, past[i + 1]!) !== 1) break;
      current++;
    }
  }

  const lastEntry = past.filter((d) => d < today).pop() ?? null;
  return {
    lastEntry,
    daysSinceLastEntry: lastEntry ? daysBetween(lastEntry, today) : null,
    current,
    longest,
    total: sorted.length,
  };
}

/** Streak over days that have actual words in them */
export function readStreak(config: Config, today: string = todayKey()): Streak {
  const written = listDayKeys(config).filter((k) => (readDay(config, k)?.entry.length ?? 0) > 0);
  return computeStreak(written, today);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Fill {{date}} and {{date:FORMAT}} in an Obsidian template */
export function renderTemplate(template: string, dateKey: string): string {
  const date = parseDateKey(dateKey);
  return template
    .replace(/\{\{date:([^}]+)\}\}/g, (_, fmt: string) => formatDate(date, fmt))
    .replace(/\{\{date\}\}/g, dateKey)
    .replace(/\{\{title\}\}/g, dateKey);
}

/**
 * Deliberately bare, used when the vault has no Templates/Daily Note.md.
 *
 * A template full of headings to fill in reads as a form, and a form invites
 * compliance rather than writing. ikigai-kan is one integer because a scale that
 * costs a keystroke gets filled in daily and a scale that costs a sentence does not.
 */
export const FALLBACK_TEMPLATE = `---
date: {{date}}
tags: [daily]
ikigai-kan:
---

# {{date:dddd, MMMM D, YYYY}}

## Entry

`;

function readTemplate(config: Config): string | null {
  const path = join(vaultPath(config, "templates"), "Daily Note.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/**
 * Append to the Entry section, creating the note if absent.
 *
 * This merges rather than overwrites because two devices can touch the same day:
 * everything already below Entry has to survive a phone entry landing later.
 */
export function appendToEntry(config: Config, dateKey: string, text: string): string {
  const path = notePath(config, dateKey);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;

  let content: string;
  if (existing === null) {
    const seeded = renderTemplate(readTemplate(config) ?? FALLBACK_TEMPLATE, dateKey);
    content = seeded.includes(ENTRY_HEADING) ? seeded : `${seeded.trimEnd()}\n\n${ENTRY_HEADING}\n`;
  } else {
    content = existing;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, insertUnder(content, ENTRY_HEADING, text), "utf-8");
  return path;
}

/** Place text at the end of a section, leaving later sections untouched */
export function insertUnder(content: string, heading: string, text: string): string {
  const start = content.indexOf(heading);
  if (start === -1) return `${content.trimEnd()}\n\n${heading}\n\n${text}\n`;

  const after = start + heading.length;
  const rest = content.slice(after);
  const next = rest.search(/^## /m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  const tail = next === -1 ? "" : rest.slice(next);

  const joined = body ? `${body}\n\n${text}` : text;
  return `${content.slice(0, after)}\n\n${joined}\n\n${tail}`.trimEnd() + "\n";
}

export { todayKey, toDateKey, daysBetween };
