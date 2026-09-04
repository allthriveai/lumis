import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { Config, VaultPaths } from "./types.js";

/**
 * Defaults match the vault layout Lumis expects. Anything in .lumisrc wins.
 * These are relative to the vault, never absolute — an absolute path here would
 * be someone's private directory baked into a public repo.
 */
export const DEFAULT_PATHS: VaultPaths = {
  dailyNotes: "Life/Journal",
  dailyNoteFormat: "YYYY-MM-DD",
  moments: "Life/Moments",
  reviews: "Life/Reviews",
  templates: "Templates",
  goals: "Lumis/Goals.md",
  ikigai: "Lumis/Ikigai.md",
};

/**
 * Where .lumisrc is looked for, in order. The cwd entry is what makes this work
 * when Claude Code is running inside the vault, which is the normal case.
 */
function candidates(): string[] {
  return [join(process.cwd(), ".lumisrc"), join(homedir(), ".lumisrc")];
}

function readRc(): { path: string; data: Partial<Config> } | null {
  for (const path of candidates()) {
    if (!existsSync(path)) continue;
    try {
      return { path, data: JSON.parse(readFileSync(path, "utf-8")) as Partial<Config> };
    } catch (err) {
      // A malformed rc is worth failing loudly on. Silently falling back to
      // defaults would point Lumis at the wrong vault and write there.
      throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
    }
  }
  return null;
}

export function loadConfig(overrides?: Partial<Config>): Config {
  const rc = readRc();
  // LUMIS_VAULT beats .lumisrc on purpose. Setting an environment variable is a
  // deliberate act; a config file two directories up is ambient. Without this,
  // a ~/.lumisrc silently captured every run and there was no way to point the
  // tool at a different vault — including a fixture one.
  const vaultPath = overrides?.vaultPath ?? process.env.LUMIS_VAULT ?? rc?.data.vaultPath ?? "";

  if (!vaultPath) {
    throw new Error(
      "No vault configured. Copy .lumisrc.example to .lumisrc and set vaultPath, " +
        "or set LUMIS_VAULT.",
    );
  }

  const paths = { ...DEFAULT_PATHS };
  for (const key of Object.keys(DEFAULT_PATHS) as (keyof VaultPaths)[]) {
    paths[key] = overrides?.paths?.[key] ?? rc?.data.paths?.[key] ?? DEFAULT_PATHS[key];
  }

  return {
    vaultPath: resolve(vaultPath.replace(/^~/, homedir())),
    paths,
  };
}

/** Absolute path to a configured location inside the vault */
export function vaultPath(config: Config, key: keyof VaultPaths): string {
  return join(config.vaultPath, config.paths[key]);
}
