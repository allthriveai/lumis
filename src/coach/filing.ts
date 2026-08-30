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
import { join, relative, basename, extname } from "node:path";
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
  inboundLinks: number;
  /** True when the filename is shared, so bare links cannot be attributed */
  ambiguousName: boolean;
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

  for (const file of walk(vaultPath)) {
    const stem = basename(file, ".md");
    basenameFiles.set(stem, (basenameFiles.get(stem) ?? 0) + 1);
    for (const match of file.endsWith(".md") ? readFileSync(file, "utf-8").matchAll(/\[\[([^\]|#]+)/g) : []) {
      const target = match[1]!.trim().replace(/\.md$/, "");
      targets.set(target, (targets.get(target) ?? 0) + 1);
    }
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
  const withoutExt = relPath.replace(/\.md$/, "");
  const stem = basename(withoutExt);
  const shared = (index.basenameFiles.get(stem) ?? 0) > 1;

  let count = 0;
  for (const [target, n] of index.targets) {
    if (target === withoutExt || target.endsWith(`/${withoutExt}`)) count += n;
    else if (!shared && target === stem) count += n;
  }
  return { count, ambiguous: shared };
}

interface Shape {
  isDaily: boolean;
  isMoment: boolean;
  date: string | null;
  empty: boolean;
}

function shapeOf(file: string): Shape {
  const raw = readFileSync(file, "utf-8");
  const { frontmatter, content } = parseFrontmatter<Record<string, unknown>>(raw);
  const tags = frontmatter["tags"];
  const list = Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? [tags] : [];
  const name = basename(file, ".md");

  return {
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
    else if (shape.isDaily) {
      proposal = shape.date
        ? join(config.paths.dailyNotes, `${shape.date}.md`)
        : join(config.paths.dailyNotes, name);
    }

    const inbound = inboundLinks(index, rel);
    found.push({
      path: rel,
      reason: shape.empty ? `${reason}, and it is empty` : reason,
      proposal: shape.empty ? null : proposal,
      inboundLinks: inbound.count,
      ambiguousName: inbound.ambiguous,
      empty: shape.empty,
    });
  };

  // Loose notes at the vault root — where a phone note lands when no folder was picked
  for (const name of readdirSync(vault)) {
    if (extname(name) !== ".md" || ROOT_KEEP.has(name)) continue;
    consider(join(vault, name), "sitting at the vault root");
  }

  // The phone inbox: everything here is by definition waiting to be triaged
  // A README in the inbox documents the inbox; it is not waiting to be triaged.
  const inbox = join(vault, "Raw phone");
  for (const file of walk(inbox)) {
    if (basename(file) === "README.md") continue;
    consider(file, "waiting in the phone inbox");
  }

  // Inside Life/, a daily note outside the journal or a moment outside Moments
  const daily = join(vault, config.paths.dailyNotes);
  const moments = join(vault, config.paths.moments);
  for (const file of walk(join(vault, "Life"))) {
    if (file.startsWith(daily) || file.startsWith(moments)) continue;
    if (basename(file) === "README.md") continue;
    const shape = shapeOf(file);
    if (shape.isDaily) consider(file, "looks like a daily note, filed outside the journal");
    else if (shape.isMoment) consider(file, "looks like a moment, filed outside Moments");
  }

  return found.sort((a, b) => a.path.localeCompare(b.path));
}
