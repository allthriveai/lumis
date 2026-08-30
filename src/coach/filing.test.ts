import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMisfiled } from "./filing.js";
import { DEFAULT_PATHS } from "../config.js";
import type { Config } from "../types.js";

let vault: string;
let config: Config;

const write = (rel: string, body: string) => {
  const full = join(vault, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body, "utf-8");
};

beforeEach(() => {
  // A scratch vault, not the fixture — these tests create deliberately broken layouts.
  vault = mkdtempSync(join(tmpdir(), "lumis-filing-"));
  config = { vaultPath: vault, paths: { ...DEFAULT_PATHS } };
  mkdirSync(join(vault, "Life/Journal"), { recursive: true });
  mkdirSync(join(vault, "Life/Moments"), { recursive: true });
  write("Home.md", "# Home\n");
  write("CLAUDE.md", "# Schema\n");
  write("Life/Journal/2026-08-29.md", "---\ndate: 2026-08-29\ntags: [daily]\n---\n\n## Entry\n\nfine\n");
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

const paths = () => findMisfiled(config).map((m) => m.path);

describe("findMisfiled", () => {
  it("leaves a correctly filed vault alone", () => {
    expect(findMisfiled(config)).toEqual([]);
  });

  it("does not flag the files that belong at the root", () => {
    expect(paths()).not.toContain("Home.md");
    expect(paths()).not.toContain("CLAUDE.md");
  });

  it("catches a phone note stranded at the root and dates it from frontmatter", () => {
    write("Untitled.md", "---\ndate: 2026-09-02\ntags: [daily]\n---\n\n## Entry\n\nwords\n");
    const [found] = findMisfiled(config);
    expect(found!.path).toBe("Untitled.md");
    expect(found!.proposal).toBe("Life/Journal/2026-09-02.md");
  });

  it("routes a moment to Moments, not the journal", () => {
    write("Raw phone/thing.md", "---\ndate: 2026-09-03\ntags: [moment, moment/joy]\n---\n\nsomething\n");
    expect(findMisfiled(config)[0]!.proposal).toBe("Life/Moments/thing.md");
  });

  it("catches a daily note filed elsewhere inside Life", () => {
    write("Life/Personal/2026-09-04.md", "---\ndate: 2026-09-04\ntags: [daily]\n---\n\n## Entry\n\nwords\n");
    expect(findMisfiled(config)[0]!.proposal).toBe("Life/Journal/2026-09-04.md");
  });

  it("refuses to guess a destination it cannot infer", () => {
    write("Mystery.md", "---\ntags: [something]\n---\n\n# Who knows\n\nunclear\n");
    const [found] = findMisfiled(config);
    expect(found!.proposal).toBeNull();
  });

  it("reports an empty note without proposing a home for it", () => {
    write("Empty.md", "---\ntags: []\n---\n");
    const [found] = findMisfiled(config);
    expect(found!.empty).toBe(true);
    expect(found!.proposal).toBeNull();
  });

  it("ignores the phone inbox's own README", () => {
    write("Raw phone/README.md", "# Raw phone\n\nwhat this folder is for\n");
    expect(findMisfiled(config)).toEqual([]);
  });

  it("never touches Work, Wiki or Sources", () => {
    write("Work/Projects/2026-09-05.md", "---\ndate: 2026-09-05\ntags: [daily]\n---\n\n## Entry\n\nx\n");
    write("Sources/Meetings/2026-09-06.md", "---\ntags: [daily]\n---\n\n## Entry\n\nx\n");
    expect(findMisfiled(config)).toEqual([]);
  });
});

describe("proposals that would destroy something", () => {
  it("withholds the proposal when a note already sits at the destination", () => {
    // A phone scrap dated the same day as a real entry is the common case, and
    // `mv` would overwrite the day's actual writing.
    write("Untitled.md", "---\ndate: 2026-08-29\ntags: [daily]\n---\n\n## Entry\n\nscrap\n");
    const [found] = findMisfiled(config);
    expect(found!.proposal).toBeNull();
    expect(found!.blockedBy).toBe("Life/Journal/2026-08-29.md");
  });

  it("proposes normally when the destination is free", () => {
    write("Untitled.md", "---\ndate: 2026-09-09\ntags: [daily]\n---\n\n## Entry\n\nscrap\n");
    const [found] = findMisfiled(config);
    expect(found!.proposal).toBe("Life/Journal/2026-09-09.md");
    expect(found!.blockedBy).toBeNull();
  });

  it("will not file a dateless daily note where nothing can read it", () => {
    // listDayKeys only reads YYYY-MM-DD files, so Life/Journal/grocery.md would
    // be invisible forever — and never flagged again, since it now sits in the
    // folder it supposedly belongs to.
    write("grocery thoughts.md", "---\ntags: [daily]\n---\n\n## Entry\n\nno date\n");
    const [found] = findMisfiled(config);
    expect(found!.proposal).toBeNull();
  });
});

describe("surviving bad input", () => {
  it("reports a note with unparseable frontmatter instead of crashing", () => {
    write("Broken.md", '---\ntags: [a\nfoo: "unclosed\n---\n\nbroken\n');
    const [found] = findMisfiled(config);
    expect(found!.unreadable).toBe(true);
    expect(found!.proposal).toBeNull();
  });

  it("does not die on a directory named like a note", () => {
    mkdirSync(join(vault, "Notes.md"));
    expect(() => findMisfiled(config)).not.toThrow();
  });

  it("returns nothing rather than throwing when the vault is missing", () => {
    expect(() => findMisfiled({ ...config, vaultPath: join(vault, "nope") })).not.toThrow();
  });

  it("scans a folder whose name merely starts with the journal folder's name", () => {
    write("Life/Journal Archive/2026-01-01.md", "---\ndate: 2026-01-01\ntags: [daily]\n---\n\n## Entry\n\nold\n");
    expect(paths()).toContain("Life/Journal Archive/2026-01-01.md");
  });
});

describe("inbound link counting", () => {
  it("counts a link that names the file's path", () => {
    write("Untitled.md", "---\ndate: 2026-09-02\ntags: [daily]\n---\n\n## Entry\n\nx\n");
    write("Life/Journal/2026-08-29.md", "See [[Untitled]] for more\n");
    expect(findMisfiled(config)[0]!.inboundLinks).toBe(1);
  });

  it("counts links Obsidian resolves but a naive matcher misses", () => {
    // Obsidian resolves wikilinks case-insensitively, and a markdown link
    // breaks on a move exactly the same way. Reporting 0 here and then moving
    // the file is how links break silently.
    write("Untitled.md", "---\ndate: 2026-09-02\ntags: [daily]\n---\n\n## Entry\n\nx\n");
    write("Life/Journal/2026-08-29.md", "[[untitled]] and [see](Untitled.md)\n");
    expect(findMisfiled(config)[0]!.inboundLinks).toBe(2);
  });

  it("suppresses bare links when the filename is shared", () => {
    // Two files named Notes.md. A bare [[Notes]] cannot be attributed to either,
    // and guessing produced counts like "23 links would break" for a README.
    write("Raw phone/Notes.md", "---\ntags: [daily]\n---\n\n## Entry\n\nx\n");
    write("Life/Moments/Notes.md", "---\ntags: [moment]\n---\n\nother\n");
    write("Life/Journal/2026-08-29.md", "[[Notes]] and [[Notes]] again\n");

    const found = findMisfiled(config).find((m) => m.path === "Raw phone/Notes.md");
    expect(found!.ambiguousName).toBe(true);
    expect(found!.inboundLinks).toBe(0);
  });

  it("still counts an explicit path link when the filename is shared", () => {
    write("Raw phone/Notes.md", "---\ntags: [daily]\n---\n\n## Entry\n\nx\n");
    write("Life/Moments/Notes.md", "---\ntags: [moment]\n---\n\nother\n");
    write("Life/Journal/2026-08-29.md", "[[Raw phone/Notes]] is the one\n");

    const found = findMisfiled(config).find((m) => m.path === "Raw phone/Notes.md");
    expect(found!.inboundLinks).toBe(1);
    expect(found!.ambiguousName).toBe(true);
  });
});
