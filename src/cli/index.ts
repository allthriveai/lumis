#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The lumis CLI.
//
// Every command prints a `display` block and, with --json, the numbers behind
// it. The skills print the display verbatim and interpret the numbers. Nothing
// here writes to the vault except `today --append`, and nothing here ever
// creates an empty note: looking at where you are must not change where you are.
// ---------------------------------------------------------------------------
import { existsSync, statSync } from "node:fs";
import { loadConfig, vaultPath, DEFAULT_PATHS } from "../config.js";
import type { Config, VaultPaths } from "../types.js";
import { SEVEN_NEEDS } from "../types.js";
import {
  readDay, readDays, readStreak, listDayKeys, unanalyzedDays,
  appendToEntry, carryForwardTasks, formatTask,
} from "../vault/daily.js";
import { todayKey, shiftDateKey, daysBetween } from "../vault/dates.js";
import { readGoals, cadenceStatus, stampFromDay, formatCadence } from "../coach/targets.js";
import { buildReceipt, describeGap } from "../coach/receipt.js";
import { computeDrift, DEFAULT_WINDOW_DAYS } from "../coach/drift.js";
import {
  partitionByKan, kanTrend, readSources, checkSources, readNeedHistory, starvedNeeds,
  MIN_SCORED_DAYS,
} from "../coach/ikigai.js";

const HELP = `lumis — an AI life coach that lives in your Obsidian vault

  lumis today [--append <text>]   where you are, and the day's carried tasks
  lumis week [--weeks N]          the week's numbers, drift, and targets
  lumis ikigai [--days N]         felt-sense evidence and the seven needs
  lumis check-vault               verify every configured path exists

  --json    print the numbers as JSON as well as the display block
  --date    override today, as YYYY-MM-DD (for testing)

Configuration lives in .lumisrc. See .lumisrc.example.
`;

interface Args {
  command: string;
  json: boolean;
  date: string;
  append: string | null;
  days: number | null;
  weeks: number;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };
  const days = flag("days");
  const weeks = flag("weeks");
  return {
    command: argv[0] ?? "help",
    json: argv.includes("--json"),
    date: flag("date") ?? todayKey(),
    append: flag("append"),
    days: days ? Number(days) : null,
    weeks: weeks ? Number(weeks) : 1,
  };
}

function emit(display: string, data: unknown, json: boolean): void {
  process.stdout.write(display.endsWith("\n") ? display : `${display}\n`);
  if (json) process.stdout.write(`\n${JSON.stringify(data, null, 2)}\n`);
}

// ---------------------------------------------------------------------------

function checkVault(config: Config): number {
  const rows = (Object.keys(DEFAULT_PATHS) as (keyof VaultPaths)[])
    .filter((key) => key !== "dailyNoteFormat")
    .map((key) => {
      const path = vaultPath(config, key);
      return { key, path: config.paths[key], exists: existsSync(path) };
    });

  const vaultOk = existsSync(config.vaultPath) && statSync(config.vaultPath).isDirectory();
  const missing = rows.filter((r) => !r.exists);

  const lines = [`Vault: ${vaultOk ? "ok" : "MISSING"}`, ""];
  for (const row of rows) lines.push(`  ${row.exists ? "ok     " : "missing"}  ${row.key} → ${row.path}`);
  if (missing.length > 0) {
    lines.push(
      "",
      // A renamed folder otherwise makes a skill silently create an empty
      // directory and write the day's entry somewhere nobody looks again.
      `${missing.length} path${missing.length === 1 ? "" : "s"} missing. Fix .lumisrc or create them.`,
    );
  }

  emit(lines.join("\n"), { vaultOk, paths: rows }, true);
  return vaultOk && missing.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------

function today(config: Config, args: Args): number {
  const { date } = args;

  if (args.append) {
    const path = appendToEntry(config, date, args.append);
    const day = readDay(config, date);
    const stamp = day ? stampFromDay(config, day, date) : null;
    const lines = [`Appended to ${path}`];
    if (stamp?.stamped.length) lines.push(`Stamped: ${stamp.stamped.join(", ")}`);
    if (stamp?.ambiguous.length) {
      lines.push(
        `Not stamped, tag matches more than one target: ${stamp.ambiguous.join(", ")}`,
      );
    }
    emit(lines.join("\n"), { path, stamp }, args.json);
    return 0;
  }

  const streak = readStreak(config, date);
  const window = readDays(config, shiftDateKey(date, -90), date);
  const { targets } = readGoals(config);
  const statuses = targets.map((t) => cadenceStatus(t, window, date));

  // Carry from the previous written day, aged by the gap that actually passed.
  const previousKey = listDayKeys(config).filter((k) => k < date).pop() ?? null;
  const previous = previousKey ? readDay(config, previousKey) : null;
  const carried = previous
    ? carryForwardTasks(previous.tasks, daysBetween(previousKey!, date))
    : [];

  const receipt = buildReceipt({
    streak,
    carried,
    targets: statuses,
    ikigaiKan: kanTrend(window, date, 14),
  });

  const pending = unanalyzedDays(config).filter((d) => d.dateKey !== date);
  const display = pending.length
    ? `${receipt}\nUnanalyzed entries: ${pending.map((d) => d.dateKey).join(", ")}\n`
    : receipt;

  emit(display, {
    date,
    display,
    streak,
    carried: carried.map((t) => ({ ...t, line: formatTask(t) })),
    targets: statuses,
    ikigaiKan: kanTrend(window, date, 14),
    // Typed on the phone, not yet talked through at the desk.
    unanalyzed: pending.map((d) => ({ date: d.dateKey, path: d.path })),
    todayHasNote: readDay(config, date) !== null,
  }, args.json);

  return 0;
}

// ---------------------------------------------------------------------------

function week(config: Config, args: Args): number {
  const { date } = args;
  const span = 7 * args.weeks;
  const from = shiftDateKey(date, -(span - 1));
  const days = readDays(config, shiftDateKey(date, -90), date);
  const inWeek = days.filter((d) => d.dateKey >= from);
  const { targets, milestones } = readGoals(config);
  const drift = computeDrift(days, targets, date, DEFAULT_WINDOW_DAYS);
  const trend = kanTrend(days, date, span);

  const done = inWeek.flatMap((d) => d.tasks.filter((t) => t.done));
  const open = inWeek.flatMap((d) => d.tasks.filter((t) => !t.done));

  const lines = [
    `## The week of ${from} to ${date}`,
    "",
    `Entries ${inWeek.filter((d) => d.entry.length > 0).length}/${span}` +
      ` · finished ${done.length} · open ${open.length}` +
      (trend.recent !== null ? ` · ikigai-kan ${trend.recent.toFixed(1)}` : ""),
    "",
  ];

  if (drift.missedTwice.length) {
    lines.push(`Missed twice (${drift.missedTwice.length}):`);
    for (const s of drift.missedTwice) {
      lines.push(`- ${s.target.text} — ${formatCadence(s.target.cadence)}, last ${describeGap(s.daysSinceTouch)}`);
    }
    lines.push("");
  }

  if (drift.behind.length) {
    lines.push(`Behind (${drift.behind.length}):`);
    for (const s of drift.behind) lines.push(`- ${s.target.text} — ${s.touchesThisWindow}/${s.required}`);
    lines.push("");
  }

  if (drift.staleTasks.length) {
    lines.push(`Carried over a week (${drift.staleTasks.length}):`);
    for (const { task } of drift.staleTasks) lines.push(formatTask(task));
    lines.push("");
  }

  const moments = inWeek.filter((d) => d.moment.length > 0);
  if (moments.length) {
    lines.push(`Five-second moments (${moments.length}):`);
    for (const d of moments) lines.push(`- ${d.dateKey} — ${d.moment.split("\n")[0]}`);
    lines.push("");
  }

  if (drift.silentDays.length) {
    lines.push(`Silent days in the last ${DEFAULT_WINDOW_DAYS}: ${drift.silentDays.length}, longest run ${drift.longestSilence}`, "");
  }

  const display = lines.join("\n").trimEnd() + "\n";
  emit(display, { from, to: date, display, drift, trend, milestones, days: inWeek.map((d) => d.dateKey) }, args.json);
  return 0;
}

// ---------------------------------------------------------------------------

function ikigai(config: Config, args: Args): number {
  const { date } = args;
  const span = args.days ?? 90;
  const days = readDays(config, shiftDateKey(date, -(span - 1)), date);
  const partition = partitionByKan(days);
  const sources = readSources(config);
  const evidence = checkSources(sources, days);
  const needs = readNeedHistory(config);
  const starved = starvedNeeds(needs);

  const lines = [`## Ikigai — ${span} days to ${date}`, ""];

  if (partition.insufficient) {
    // Saying this plainly is the whole safety property. A confident reading off
    // a thin window is the failure this system is built to avoid.
    const short = partition.needed - partition.scoredDayCount;
    lines.push(
      `Not enough to read yet: ${partition.scoredDayCount} days carry an ikigai-kan score, ` +
        `${partition.needed} needed.`,
      `At one reading a day that is about ${short} more day${short === 1 ? "" : "s"}.`,
      "",
      "The evidence pass is unavailable. The retrospective pass is not.",
      "",
    );
  } else {
    lines.push(
      `${partition.scoredDayCount} scored days · baseline ${partition.baseline!.toFixed(2)}`,
      "",
      `Highest ${partition.high.length}: ${partition.high.map((s) => `${s.dateKey} (${s.value})`).join(", ")}`,
      `Lowest ${partition.low.length}: ${partition.low.map((s) => `${s.dateKey} (${s.value})`).join(", ")}`,
      "",
    );
  }

  if (sources.length) {
    lines.push(`Sources claimed in Ikigai.md (${sources.length}):`);
    for (const e of evidence) {
      if (e.uncheckable) {
        lines.push(`- ${e.source.text} — no #goal tag, nothing to count against`);
      } else if (e.insufficient) {
        lines.push(`- ${e.source.text} — touched ${e.touchedDays.length} days, too few to compare`);
      } else {
        lines.push(
          `- ${e.source.text} — ${e.touchedDays.length} days, ` +
            `mean ${e.meanOnTouchedDays!.toFixed(2)} against baseline ${e.baseline!.toFixed(2)}`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push("No sources listed in Ikigai.md yet.", "");
  }

  if (starved.length) {
    lines.push(`Seven needs, lowest first (${needs[needs.length - 1]!.quarter}):`);
    for (const n of starved) lines.push(`- ${n.need} ${n.score} · history ${n.trend.join(" → ")}`);
    const unscored = SEVEN_NEEDS.filter((n) => !starved.some((s) => s.need === n));
    if (unscored.length) lines.push(`Never scored: ${unscored.join(", ")}`);
    lines.push("");
  } else {
    lines.push("No quarterly need scores recorded yet.", "");
  }

  const display = lines.join("\n").trimEnd() + "\n";
  emit(display, {
    date, window: span, display, partition, evidence, needs, starved,
    minScoredDays: MIN_SCORED_DAYS,
  }, args.json);
  return 0;
}

// ---------------------------------------------------------------------------

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  switch (args.command) {
    case "check-vault": return checkVault(config);
    case "today": return today(config, args);
    case "week": return week(config, args);
    case "ikigai": return ikigai(config, args);
    default:
      process.stderr.write(`Unknown command: ${args.command}\n\n${HELP}`);
      return 1;
  }
}

process.exit(main());
