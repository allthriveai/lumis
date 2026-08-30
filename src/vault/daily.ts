// ---------------------------------------------------------------------------
// Daily notes. The file is the database — there is no index and no state file.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Config, Day, Task } from "../types.js";
import { vaultPath } from "../config.js";
import { parseFrontmatter } from "./frontmatter.js";
import { parseDateKey, toDateKey, formatDate, daysBetween, todayKey, isDateKey } from "./dates.js";

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

// ---------------------------------------------------------------------------
// Section handling
//
// Everything here is line-based and fence-aware. The earlier substring version
// did real damage: "## Entry" matched inside "## Entry — morning" and rewrote
// the heading, and any "## " the user typed in their own writing — or inside a
// fenced code block — was treated as the start of the next section, so a second
// capture landed above the first and silently reordered the journal.
// ---------------------------------------------------------------------------

/**
 * Which lines sit inside a fenced code block, where "## " is not a heading.
 *
 * An UNTERMINATED fence is not treated as a fence. Letting one run to end of
 * file hid the "## The five-second moment" heading from everything downstream:
 * later captures landed below the moment instead of above it, and the day was
 * reported as never read. Pasting a snippet without its closing fence is an
 * ordinary thing to do, so the open case has to degrade to plain text.
 */
export function fencedLines(lines: string[]): boolean[] {
  const inFence = new Array<boolean>(lines.length).fill(false);
  let open: { at: number; marker: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i]!.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (!marker) continue;

    if (open === null) {
      open = { at: i, marker: marker[0]! };
      continue;
    }
    if (marker[0] === open.marker) {
      // Only a closed pair marks anything as fenced.
      for (let j = open.at; j <= i; j++) inFence[j] = true;
      open = null;
    }
  }
  return inFence;
}

/**
 * Which lines sit inside an HTML comment.
 *
 * Parallel to fencedLines. Commenting a line out is how a vault parks something
 * without losing it — Goals.md does it for targets — so a parser that ignores
 * comments reads parked entries as live.
 */
export function commentedLines(lines: string[]): boolean[] {
  const out = new Array<boolean>(lines.length).fill(false);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (open) {
      out[i] = true;
      if (line.includes("-->")) open = false;
      continue;
    }
    const start = line.indexOf("<!--");
    if (start === -1) continue;
    out[i] = true;
    open = !line.includes("-->", start);
  }
  return out;
}

/**
 * Index of the line holding this heading, or -1.
 *
 * Matches the whole line, so "## Entry" never matches "## Entrypoints". Falls
 * back to a heading that starts with the same word ("## Entry — morning") and
 * returns THAT line, so the user's own heading text is used as-is rather than
 * being overwritten with the canonical form.
 */
export function findHeading(lines: string[], heading: string): number {
  const fenced = fencedLines(lines);
  const want = heading.trim();
  const loose = new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

  let fallback = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const line = lines[i]!.trimEnd();
    if (line === want) return i;
    if (fallback === -1 && loose.test(line)) fallback = i;
  }
  return fallback;
}

/**
 * The headings Lumis owns. Only these end a section.
 *
 * A "## " the writer typed inside their own entry is their content, not a
 * structural boundary — treating it as one put a later capture ABOVE the
 * earlier writing and silently reordered the day.
 */
const OWNED_HEADINGS = [/^##\s+Entry\b/i, /^##\s+The\s+five-second\s+moment\b/i];

function isOwnedHeading(line: string): boolean {
  return OWNED_HEADINGS.some((re) => re.test(line));
}

/** Index of the next heading Lumis owns after `from`, or lines.length */
function nextHeading(lines: string[], from: number): number {
  const fenced = fencedLines(lines);
  for (let i = from + 1; i < lines.length; i++) {
    if (!fenced[i] && isOwnedHeading(lines[i]!)) return i;
  }
  return lines.length;
}

/** The body under a "## " heading, up to the next one. Empty when absent. */
export function sectionBody(content: string, heading: string | RegExp): string {
  const lines = content.split("\n");

  let start: number;
  if (typeof heading === "string") {
    start = findHeading(lines, heading);
  } else {
    const fenced = fencedLines(lines);
    start = lines.findIndex((line, i) => !fenced[i] && heading.test(line));
  }
  if (start === -1) return "";

  return lines.slice(start + 1, nextHeading(lines, start)).join("\n").trim();
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
    // Shape alone is not enough: a hand-typed 2025-02-29.md passes the regex
    // and then throws out of parseDateKey, taking down every command.
    .filter((k) => isDateKey(k))
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
  // Everything is computed over `past`. Using the unfiltered list for longest
  // and total let a future-dated note inflate both — one written day reported
  // "streak 1 · longest 4 · 5 total", which over-reports.
  const past = [...new Set(dates)].sort().filter((d) => d <= today);

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of past) {
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
    total: past.length,
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

/**
 * Place text at the end of a section, leaving the heading and every later
 * section untouched.
 *
 * The heading line is never rewritten and the body is never re-trimmed — what
 * was already in the file comes back out byte for byte. Only the appended text
 * is new.
 */
export function insertUnder(content: string, heading: string, text: string): string {
  const lines = content.split("\n");
  const start = findHeading(lines, heading);

  if (start === -1) {
    return `${content.trimEnd()}\n\n${heading}\n\n${text}\n`;
  }

  const end = nextHeading(lines, start);
  const body = lines.slice(start + 1, end);

  // Trim only the blank padding around the section, never the writing itself.
  let last = body.length;
  while (last > 0 && body[last - 1]!.trim() === "") last--;
  const hasWriting = body.slice(0, last).some((l) => l.trim() !== "");

  const rebuilt = [
    ...lines.slice(0, start + 1),
    "",
    ...(hasWriting ? [...trimLeadingBlank(body.slice(0, last)), ""] : []),
    ...text.split("\n"),
    "",
    ...lines.slice(end),
  ];

  // Drop trailing blank LINES without touching the last content line: two
  // trailing spaces is a markdown line break, so trimEnd() there alters meaning.
  let stop = rebuilt.length;
  while (stop > 0 && rebuilt[stop - 1]!.trim() === "") stop--;
  return rebuilt.slice(0, stop).join("\n") + "\n";
}

function trimLeadingBlank(lines: string[]): string[] {
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === "") first++;
  return lines.slice(first);
}

export { todayKey, toDateKey, daysBetween };
