# 0001. Tiered AI context system, adapted from product-catalog

- **Status:** Accepted (approved at the M0 close, 2026-10-26)
- **Date:** 2026-10-26

## Context
- The AI assistant writes this repo across many sessions (milestones M0–M8). Every session needs the role split, the rules, and where we are, without filling the context window.
- product-catalog used a tiered context system ([product-catalog ADR-0002](https://github.com/AbanobNageh/product-catalog/blob/main/docs/adr/0002-tiered-ai-context-system.md)) for 23 milestones. Its experiment log shows what worked:
  - after `/clear` or a compaction, "let's continue" restated the right milestone from `STATUS.md`
  - tick-only checklists with commit hashes kept progress claims checkable
  - specific, non-obvious rules ("check current versions", "don't guess at gaps") changed behaviour; overviews didn't
  - from Part 5: a plan with a Review Focus, test-first work, and a fresh reviewer on the whole uncommitted diff found real defects every milestone
- And what didn't:
  - path-scoped rules didn't load when files were read with `cat` through Bash, or before their folder existed
  - shell heredocs and PowerShell 5.1 quoting broke commands and files several times
  - untested commands went into the docs
- This repo differs: the AI builds everything (no tutoring), the spec is a single user-written `REQUIREMENTS.md`, and the subject (MCP, agent loops) is new to the user, who must be able to explain it in an interview.
- The research behind the original design is in [product-catalog's research report](https://github.com/AbanobNageh/product-catalog/blob/main/docs/research/2026-10-21-ai-context-structures/report.md). It isn't copied here.

## Considered options
1. **Copy product-catalog's system as it is,** including the tutor rules, the `teach-module` skill and the learning notes.
2. **Adapt it:** keep the tiers (always-loaded `AGENTS.md` + `docs/STATUS.md`, a `close-milestone` skill, on-demand spec, ADRs and milestone docs, permission rules), drop the tutor tier, and make the Part 5 review loop the default routine.
3. **Only a `CLAUDE.md`** with a pointer to `REQUIREMENTS.md`.

## Decision
**Option 2.**
- **Always loaded** (~90 lines): `AGENTS.md` (overview, the builder, setup, commands, who writes what, rules, session routine, map) and `docs/STATUS.md`, both imported by `CLAUDE.md`.
- **Procedure:** `.claude/skills/close-milestone/SKILL.md`, rewritten for M0–M8 and for the review loop.
- **On demand:** `REQUIREMENTS.md` as the spec, kept whole (the user's choice, 2026-10-26); `docs/adr/` numbered from 0001; `docs/milestones/` with a plan and a note per milestone.
- **Enforced, as a backstop:** `.claude/settings.json` makes the usual forms of pushes, GitHub repo, secret and release commands, Docker volume deletes, and the Phase 2 commands that spend OpenRouter credit always prompt. The rules match command prefixes, so a variant (`git -C . push`, `docker compose -f … down -v`) can slip past them. They aren't a security boundary; the "never without go-ahead" rule in `AGENTS.md` is still the main control.
- **No path-scoped rules for now.** The few code rules that matter (stdout is the protocol, never log a key) are short enough to load always, and `src/` doesn't exist yet. Revisit if they're missed.
- **Lessons carried over as rules:** the PowerShell 5.1 gotchas, "test a command before it goes into `AGENTS.md`", "check official docs at each milestone".

Option 1 would load tutor rules that contradict how this repo is built. Option 3 is the setup product-catalog started from and replaced: a prose "read this file" is only followed if the model decides to.

## Consequences
- Good: a small, deterministic always-on context; progress claims are checkable; each file has one owner and one edit rule; works across tools through `AGENTS.md`.
- Good: the user's spec stays one readable document, which is also what the README can link as the brief.
- Bad: `REQUIREMENTS.md` (~400 lines) is read on demand, so a session must actually open it at the start of a milestone; the session routine says so.
- Bad: it needs pruning after each phase, or the always-loaded tier grows back.
- The experiment log in `docs/ai-workflow.md` records what works and what doesn't, milestone by milestone.

## Revisit when
At the end of Phase 1 (M4), using the experiment log.
