# Working in this repo

Lumis is a life coach that reads a private Obsidian vault. The single hardest
constraint here is that **this repo is public and the vault is not**.

## Never commit

Vault content, entries, goals, real names, absolute home paths, vault paths,
emails, API keys. `tools/check-personal.mjs` runs pre-commit and blocks these;
if it fires, fix the code rather than adding an exemption. Local name patterns
belong in `.personal-patterns` (gitignored).

Tests read `tests/fixtures/vault/` and nothing else. A test that needs a real
vault is a wrong test.

## What earns code

Anything that must produce the same number twice: dates, streaks, carry-forward
ages, cadence windows, the ikigai partition. Everything else is prompt, and
belongs in a `SKILL.md`.

The previous version died of scope — 26 skills, a 1,200-line MCP server nothing
used, and the coaching rules written twice so they drifted. Before adding a
module or a skill, check whether an existing one covers it.

## The layers

```
src/vault/     dates, frontmatter, daily notes. Knows about files.
src/coach/     targets, drift, receipt, ikigai. Knows about counting.
src/cli/       assembles and renders. Knows about output.
.claude/skills/  the coaching rules. The only place they exist.
```

`src/coach/` returns numbers. If a function there returns a sentence, it is in
the wrong file. Interpretation belongs to the skill.

## Rules the tests exist to protect

- `lumis today` creates no file. Looking must not change what is looked at.
- Under-report rather than over-report: an ambiguous `#goal` tag stamps nothing,
  a window with no journal behind it is unknown rather than missed, a barely
  touched source is insufficient data rather than a negative finding.
- `/ikigai` says nothing about high and low days below `MIN_SCORED_DAYS`. The
  5-day fixture test is the safety property; do not relax it.
- The receipt contains counts and dates only. `receipt.test.ts` asserts against
  a banned word list. If a change makes that fail, the change is wrong.
- Date keys are local calendar days. See the header comment in `vault/dates.ts`
  for the three traps that module exists to prevent.
- No module-level `/g` regex shared across parsers — `lastIndex` carries between
  callers and silently breaks the second one. Share a function instead.

## Config

`.lumisrc` (gitignored) holds `vaultPath` and a `paths` map; `src/config.ts`
resolves it from the cwd, then `~`, then `LUMIS_VAULT`. Path defaults live in
`DEFAULT_PATHS` and are always vault-relative. `lumis check-vault` asserts every
configured path exists — a renamed folder otherwise makes a skill create an
empty directory and write the day's entry somewhere nobody looks again.

`lumis setup` is the one command allowed to create things: folders, templates,
the vault-root `.lumisrc`, and the skill symlinks. It lives in `src/cli/` with
the other commands. It must stay idempotent and must never overwrite.
