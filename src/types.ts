// ---------------------------------------------------------------------------
// Every type in Lumis. One file on purpose — the old version had five and they
// drifted apart.
// ---------------------------------------------------------------------------

export interface VaultPaths {
  dailyNotes: string;
  dailyNoteFormat: string;
  moments: string;
  reviews: string;
  templates: string;
  goals: string;
  ikigai: string;
}

export interface Config {
  vaultPath: string;
  paths: VaultPaths;
}

/** A markdown checkbox line in a daily note */
export interface Task {
  text: string;
  done: boolean;
  /** Days this task has been carried forward, parsed back out of "(moved N days)" */
  movedDays: number;
  /** #goal/* tags on the line, without the "#goal/" prefix */
  goals: string[];
}

/** One daily note, parsed */
export interface Day {
  dateKey: string;
  path: string;
  /** Body of "## Entry". Empty string when the heading exists but nothing was written. */
  entry: string;
  /** Body of "## The five-second moment" */
  moment: string;
  /** frontmatter ikigai-kan, 1-5. null when unset — never guessed. */
  ikigaiKan: number | null;
  tasks: Task[];
}

export type Cadence =
  | { kind: "none" }
  | { kind: "every"; unit: "day" | "week" | "month" | "quarter" }
  | { kind: "times"; count: number; unit: "week" | "month" };

/** A checkbox line under an identity heading in Goals.md */
export interface Target {
  text: string;
  /** The "### I am someone who ..." heading this target sits under */
  identity: string;
  cadence: Cadence;
  /** Implementation intention: "when: after morning coffee" */
  when: string | null;
  /** Two-minute rule: the version that still counts on a bad day */
  floor: string | null;
  /** The #goal/<tag> that stamps this target */
  goal: string | null;
  /** last:YYYY-MM-DD, or null if never stamped */
  last: string | null;
  /** Line number in Goals.md, for rewriting the stamp in place */
  line: number;
}

/** Milestones carry no cadence, so they never nag */
export interface Milestone {
  text: string;
  goal: string | null;
  done: boolean;
}

export interface Goals {
  targets: Target[];
  milestones: Milestone[];
}

/** Kamiya's seven needs, in her order. Life satisfaction is the most basic. */
export const SEVEN_NEEDS = [
  "life-satisfaction",
  "change-and-growth",
  "bright-future",
  "resonance",
  "freedom",
  "self-actualization",
  "meaning-and-value",
] as const;

export type Need = (typeof SEVEN_NEEDS)[number];
