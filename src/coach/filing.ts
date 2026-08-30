// ---------------------------------------------------------------------------
// Filing hygiene.
//
// A note typed on the phone without picking a folder lands at the vault root.
// That is where stray Untitled.md files come from, and they are invisible to
// every skill that reads Life/Journal.
//
// This module only ever REPORTS. It does not move anything. Moving a file by
// shell breaks every [[wikilink]] pointing at it — Obsidian rewrites links when
// Obsidian does the move, not when something else does — so each candidate
// carries its inbound link count and a human decides.
//
// Scope is deliberately narrow: the vault root, the phone inbox, and Life/.
// Work/, Wiki/, Sources/ and Amplify/ belong to other systems, and a life coach
// reorganising them is not tidying, it is trespassing.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, extname, sep } from "node:path";
import type { Config } from "../types.js";
import { parseFrontmatter } from "../vault/frontmatter.js";
import { normalizeDateKey } from "../vault/dates.js";

/** Root files that belong at the root */
const ROOT_KEEP = new Set(["Home.md", "CLAUDE.md", "README.md", "AGENTS.md", "index.md"]);

/** Folders scanned for inbound links, and skipped when walking for candidates */
const SKIP_DIRS = new Set([".git", ".obsidian", ".claude", "node_modules", ".trash"]);

const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/;

export interface Misfiled {
  /** Vault-relative path */
  path: string;
  reason: string;
  /** Vault-relative destination, or null when the right place is not obvious */
  proposal: string | null;
  /**
   * Set when something already sits where this file would go. The proposal is
   * withheld in that case: following it would overwrite a real note.
   */
  blockedBy: string | null;
  inboundLinks: number;
  /** True when the filename is shared, so bare links cannot be attributed */
  ambiguousName: boolean;
  /** True when the frontmatter could not be parsed, so the shape is a guess */
  unreadable: boolean;
  empty: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (extname(name) === ".md") out.push(full);
  }
  return out;
}

interface LinkIndex {
  /** Every [[link]] target in the vault, normalised, with occurrence counts */
  targets: Map<string, number>;
  /** How many .md files share each basename */
  basenameFiles: Map<string, number>;
}

function buildLinkIndex(vaultPath: string): LinkIndex {
  const targets = new Map<string, number>();
  const basenameFiles = new Map<string, number>();

  const add = (raw: string) => {
    // Obsidian resolves links case-insensitively, so the index is lowercased.
    const target = decodeURIComponent(raw.trim()).replace(/\.md$/i, "").toLowerCase();
    if (target) targets.set(target, (targets.get(target) ?? 0) + 1);
  };

  for (const file of walk(vaultPath)) {
    const stem = basename(file, ".md").toLowerCase();
    basenameFiles.set(stem, (basenameFiles.get(stem) ?? 0) + 1);

    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) add(m[1]!);
    // Markdown links break on a move exactly the same way wikilinks do.
    for (const m of text.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) add(m[1]!);
  }
  return { targets, basenameFiles };
}

/**
 * Count links that would break if this file moved.
 *
 * A bare [[Note]] link is only attributed when that basename is unique in the
 * vault. Counting every bare link with a matching name reported 23 broken links
 * for a README, because README is the most common filename there is — and a
 * scary number nobody can verify is worse than an honest "unknown".
 */
function inboundLinks(index: LinkIndex, relPath: string): { count: number; ambiguous: boolean } {
  const full = relPath.replace(/\.md$/i, "").toLowerCase().split(sep).join("/");
  const stem = basename(full);
  const shared = (index.basenameFiles.get(stem) ?? 0) > 1;

  let count = 0;
  for (const [target, n] of index.targets) {
    if (target === full) {
      count += n;
      continue;
    }
    // Suffix matching is only for links that actually name a path
    // ("Journal/2026-01-01"). Without that guard a bare [[Notes]] matched
    // "raw phone/notes" through the suffix rule and slipped past the
    // shared-name check entirely.
    if (target.includes("/")) {
      if (full.endsWith(`/${target}`) || target.endsWith(`/${full}`)) count += n;
      continue;
    }
    if (!shared && target === stem) count += n;
  }
  return { count, ambiguous: shared };
}

interface Shape {
  isDaily: boolean;
  isMoment: boolean;
  date: string | null;
  empty: boolean;
  unreadable: boolean;
}

function shapeOf(file: string): Shape {
  const name = basename(file, ".md");
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return { isDaily: DATE_NAME.test(name), isMoment: false, date: null, empty: false, unreadable: true };
  }
  // parseFrontmatter absorbs malformed YAML and reports it rather than throwing,
  // so the body is still usable and one bad scrap cannot take out the report.
  const { frontmatter, content, unreadable } = parseFrontmatter<Record<string, unknown>>(raw);
  if (unreadable) {
    return { isDaily: DATE_NAME.test(name), isMoment: false, date: null, empty: false, unreadable: true };
  }
  const tags = frontmatter["tags"];
  const list = Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? [tags] : [];

  return {
    unreadable: false,
    isDaily: list.includes("daily") || DATE_NAME.test(name) || /^##\s+Entry\s*$/m.test(content),
    isMoment: list.some((t) => t === "moment" || t.startsWith("moment/")) || "moment-type" in frontmatter,
    date: normalizeDateKey(frontmatter["date"]) ?? (DATE_NAME.test(name) ? name : null),
    empty: content.trim().length === 0,
  };
}

/**
 * Find notes that look filed in the wrong place.
 *
 * Under-reports on purpose. A file whose destination is not obvious is returned
 * with a null proposal rather than a guess, because a confident wrong move is
 * worse than an unanswered question.
 */
export function findMisfiled(config: Config): Misfiled[] {
  const vault = config.vaultPath;
  const index = buildLinkIndex(vault);
  const found: Misfiled[] = [];

  const consider = (file: string, reason: string) => {
    const rel = relative(vault, file);
    const shape = shapeOf(file);
    const name = basename(file);

    let proposal: string | null = null;
    if (shape.isMoment) proposal = join(config.paths.moments, name);
    else if (shape.isDaily && shape.date) {
      proposal = join(config.paths.dailyNotes, `${shape.date}.md`);
    }
    // A daily-shaped note with no date gets no proposal on purpose. Filing it
    // under its own name would put it inside Life/Journal, where listDayKeys
    // only reads YYYY-MM-DD files — invisible to every reader, and no longer
    // flagged here either, because it now sits in the folder it belongs to.
    // The move meant to end its invisibility would make it permanent.

    if (shape.empty || shape.unreadable) proposal = null;

    // Refuse a proposal that would land on top of an existing note. A phone
    // scrap dated the same day as a real entry is the common case, and `mv`
    // would destroy the day's actual writing.
    let blockedBy: string | null = null;
    if (proposal && existsSync(join(vault, proposal))) {
      blockedBy = proposal;
      proposal = null;
    }

    const inbound = inboundLinks(index, rel);
    const notes = [reason];
    if (shape.empty) notes.push("and it is empty");
    if (shape.unreadable) notes.push("and its frontmatter will not parse");

    found.push({
      path: rel,
      reason: notes.join(", "),
      proposal,
      blockedBy,
      inboundLinks: inbound.count,
      ambiguousName: inbound.ambiguous,
      unreadable: shape.unreadable,
      empty: shape.empty,
    });
  };

  // Loose notes at the vault root — where a phone note lands when no folder was picked
  if (existsSync(vault)) {
    for (const name of readdirSync(vault)) {
      if (extname(name) !== ".md" || ROOT_KEEP.has(name)) continue;
      const full = join(vault, name);
      // A directory can be named "Notes.md"; reading it throws EISDIR.
      if (!statSync(full).isFile()) continue;
      consider(full, "sitting at the vault root");
    }
  }

  // The phone inbox: everything here is by definition waiting to be triaged
  // A README in the inbox documents the inbox; it is not waiting to be triaged.
  const inbox = join(vault, "Raw phone");
  for (const file of walk(inbox)) {
    if (basename(file) === "README.md") continue;
    consider(file, "waiting in the phone inbox");
  }

  // Inside Life/, a daily note outside the journal or a moment outside Moments
  // Compare on a path boundary. A raw prefix made "Life/Journal Archive/" look
  // like it was inside "Life/Journal" and silently dropped it from the scan.
  const daily = join(vault, config.paths.dailyNotes) + sep;
  const moments = join(vault, config.paths.moments) + sep;
  for (const file of walk(join(vault, "Life"))) {
    if (file.startsWith(daily) || file.startsWith(moments)) continue;
    if (basename(file) === "README.md") continue;
    const shape = shapeOf(file);
    if (shape.isDaily) consider(file, "looks like a daily note, filed outside the journal");
    else if (shape.isMoment) consider(file, "looks like a moment, filed outside Moments");
  }

  return found.sort((a, b) => a.path.localeCompare(b.path));
}
