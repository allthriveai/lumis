# Lumis

An AI life coach that lives in your Obsidian vault.

You journal. Lumis reads what you wrote, tracks the habits you said you wanted,
and — once there is enough of it — tells you what your best days actually had in
common. No data leaves your vault, and none of it lives in this repo.

Built on four frameworks, each doing one job:

| | Job | Source |
|---|---|---|
| **Ikigai** | direction | Mieko Kamiya, *Ikigai ni tsuite* (1966) — the seven needs, not the Venn diagram |
| **Atomic Habits** | mechanics | identity-based habits, implementation intentions, never miss twice |
| **Storyworthy** | noticing | Matthew Dicks' Homework for Life — one five-second moment a day |
| **The Artist's Way** | permission | Julia Cameron's rule for the page: it is a brain drain, not art |

## The idea

Two repos, one vault, and the vault is the seam.

- **This repo** holds code, skills and templates. Never any vault content.
- **Your vault** holds everything else — entries, goals, moments, reviews.

The coaching rules live in `.claude/skills/`, in one place. The CLI computes
anything that has to produce the same number twice: dates, streaks, carry-forward
ages, cadence windows, the ikigai partition. Everything else is prompt.

## Setup

```sh
npm install && npm run build
npm link                         # puts `lumis` on your PATH
cp .lumisrc.example .lumisrc     # set vaultPath
npm run check:vault              # every configured path must exist
```

`.lumisrc` is gitignored. Your vault's location never enters this repo.

Copy the templates into your vault and edit them:

```sh
cp "templates/vault/Daily Note.md" "$VAULT/Templates/"
cp templates/vault/Goals.md templates/vault/Ikigai.md "$VAULT/Lumis/"
```

`npm link` matters: the skills shell out to `lumis`, so it has to be on your
PATH. Run the skills from inside your vault, where `.lumisrc` is picked up from
the working directory.

Then make the skills available from inside your vault:

```sh
for s in journal check-in review ikigai; do ln -s "$PWD/.claude/skills/$s" ~/.claude/skills/$s; done
```

## The loop

| | When | What |
|---|---|---|
| `/journal` | any time | free-hand writing, captured verbatim. Says nothing back |
| `/check-in` | daily | receipt, entry, five-second moment, reflection — in that order |
| `/review` | weekly | reads notes you wrote alone, what slipped, filing, next week's WOOP |
| `/ikigai` | quarterly | the seven needs, and what your high days have in common |

`/journal` and `/check-in` are deliberately separate. Capture and coaching are
different activities, and doing them at once ruins the first: morning pages work
because nothing is reading over your shoulder, so `/journal` writes what you
give it and replies with a word count. `/check-in` is where the coach is
actually in the room. Everything `/journal` captures lands under `## Entry`,
which is what `/check-in` and `/review` read.

The CLI underneath, if you want it directly:

```sh
lumis today                  # where you are; creates nothing
lumis today --append-stdin   # capture free-hand writing from stdin
lumis week
lumis ikigai
lumis tidy                   # notes that look filed in the wrong place
lumis check-vault
```

Add `--json` to any of them for the numbers behind the display.

## Design rules

These are the ones that took a rewrite to learn.

**Looking at where you are must not change where you are.** `lumis today`
creates no file. An earlier version scaffolded an empty note every time you
checked, which inflated the streak with days nobody wrote in.

**The file is the database.** No index, no cursor, no event log. Cadence is
scored by counting days in the notes. A second store is a second thing to fall
out of sync, and it did.

**Under-report rather than over-report.** A `#goal` tag matching two targets
stamps neither. A cadence window with no journal behind it is unknown, not
missed. A source touched twice in ninety days is insufficient data, not a
disproved claim. A coach that overstates gets ignored, and then it is worth
nothing at all.

**Say nothing on thin data.** `/ikigai` refuses to read your high and low days
until 60 of them carry a score, and says how many more are needed. A confident
reading off three weeks is the specific failure this is built to avoid.

**The receipt is rendered, not generated.** Every session opens with a block of
counts and dates produced by code. Prose written fresh each morning drifts
warmer over time; a rendered block does not.

**Cite or shut up.** Any claim about a pattern names the file and date it came
from.

## Not a therapist

Lumis is a journal with a coach attached. It is not a clinician, it cannot
assess risk, and it is not a substitute for care. The skills are written to stop
coaching and say so when something clinical comes up. In the US, 988 is the
Suicide and Crisis Lifeline.

## Development

```sh
npm test              # fixture vault only; tests never read a real vault
npm run lint
npm run check:personal
```

`tools/check-personal.mjs` runs as a pre-commit hook and blocks home paths,
vault paths, emails and API keys. Names go in `.personal-patterns`, which is
gitignored.

MIT.
