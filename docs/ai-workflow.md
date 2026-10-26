# How this project works with an AI assistant

This repo is built with an AI coding assistant (Claude Code). The split is deliberate: **the AI writes the code, tests and docs and explains them; I make the design decisions, review every milestone and run the checks.** Everything outward-facing (the GitHub repo, pushes, secrets, OpenRouter keys and spend) is mine.

This page explains the context system that keeps the assistant on track across many sessions. It's adapted from the one used in [product-catalog](https://github.com/AbanobNageh/product-catalog/blob/main/docs/ai-workflow.md), where it ran for 23 milestones. The reasoning is in [ADR-0001](adr/0001-tiered-ai-context-system.md). **It's still an experiment.** The log at the bottom records how it goes here.

## The idea: organise context by *when it loads*
Every token loaded into the model's context costs attention, so only the things needed every time are loaded every time.

| Tier | Files | When the model sees it |
|---|---|---|
| Always | `AGENTS.md` (role split, rules, session routine, map), `docs/STATUS.md` (where we are), both imported by `CLAUDE.md` | Every session, at launch |
| Procedures | `.claude/skills/close-milestone` | The description is always visible; the body loads when invoked |
| On demand | `REQUIREMENTS.md` (the spec), `docs/adr/`, `docs/milestones/` (plans and notes) | When the routine or a task says to read them |
| Enforced | `.claude/settings.json`: the usual forms of pushes, repo and secret commands, volume deletes and spending commands always prompt | Always; enforced by the tool, not by the model. Prefix rules, so a backstop rather than a boundary |

**What's different from product-catalog:**
- **No tutor tier.** product-catalog's Parts 2–3 were for learning Kubernetes and Terraform, so it had a `teach-module` skill, path-scoped tutor rules and private learning notes. Here the AI builds, as in product-catalog's Parts 1 and 5, so those are gone. What remains of tutoring is one always-loaded rule: define every MCP and agent-loop concept on first use.
- **The spec is one file I wrote,** `REQUIREMENTS.md`, kept whole rather than split into `docs/plan/`. It already repeats everything it needs from product-catalog.
- **The review loop is in the routine from the start.** product-catalog arrived at it in Part 5 (a plan with a Review Focus, test-first, a fresh reviewer on the whole diff, findings re-graded by their effect). Here it's the default for every milestone.
- **No path-scoped rules yet.** One for `src/` (stdout, logging, secrets) may be added once the code exists, if the always-loaded rules turn out not to be enough.

## Ownership: one owner and one edit rule per file
- **Me:** `REQUIREMENTS.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/`. The AI proposes changes and applies them only after I approve. Exception: the AI fills in the Commands section of `AGENTS.md` as it builds.
- **The AI:** `docs/STATUS.md`. It rewrites the "Now" block; the checklist is tick-only, and each tick carries a date, the commit hash and a link to the milestone note. It also writes the plans and notes in `docs/milestones/`, which are frozen once committed.
- **Append-only:** `docs/adr/`. A changed decision gets a new ADR that supersedes the old one.

## Session routine
1. **Start:** the assistant reads `git log`, reads the current milestone's plan, restates where we are in 3 lines, and smoke-checks anything already built or running.
2. **Plan:** it reads the code and docs, asks me the real decisions one set at a time, writes a proposed ADR for each real choice, and writes a plan in `docs/milestones/` with a Review Focus.
3. **Build:** test-first, with nothing committed until the milestone closes. Gaps in the spec become `[NEEDS CLARIFICATION]` questions, not guesses.
4. **Review:** a fresh reviewer (a new agent that hasn't seen the build's reasoning) checks the whole uncommitted diff. The assistant re-grades its findings by their real effect and fixes them, test-first for code.
5. **Close** (`close-milestone` skill): verify the "Done when" checks with evidence → tour → milestone note (including what I and the reviewer caught) → commit after my yes → tick STATUS → one line in the experiment log.
6. **Between milestones:** `/clear`, so the next session starts fresh from the files on disk.
7. **After each phase:** prune the always-loaded files.

## Experiment log
One line per milestone: what the context system helped with, or got wrong.

| Date | Milestone | Observation |
|---|---|---|
| 2026-10-26 | M0 | The system was built during this milestone, so no fresh session has used it yet. Helped: "check the official docs at each milestone" (carried over from product-catalog) found the stateless 2026-07-28 MCP spec and the split v2 SDK before any code, which turned the toolchain into four questions the user answered in one round. Running every command before it went into `AGENTS.md` caught `up -d` returning before catalog-api was healthy. The fresh reviewer, given only the plan and the tree, found the most important defect: a key-leak path through `fetch` errors that product-catalog had already closed and the AI didn't carry over. Missed: ADR-0001 and this page overclaimed what the permission rules enforce. The `close-milestone` skill inherited a step order that left the log line out of the close commit. After it was fixed on disk, invoking the skill still loaded the copy from the session start, so the AI followed the file instead. |
| 2026-10-26 | M1 | Run in the same session as M0's close, with no `/clear` in between. Helped: the milestone flow put the timeout-simulation question in front of the user before any code. Reading catalog-api's code at the tag first found a fact no test would have shown: it commits before its index call, so a paused search-service gives a real late answer. Mutation checks (break a rule, see a test fail) gave the confirm logic evidence beyond "tests pass". The fresh reviewer found the milestone's one Important defect: a plain failure reported after an ambiguous write. It also found a claimed test that didn't exist, which it proved with a mutation. Missed: the AI's first pause test could pass for the wrong reason (a timeout below the normal write latency), its first diagnosis of the resulting flake was wrong, and ADR-0004 shipped wrong numbers until the review. While fixing the review, the AI broke `AGENTS.md`'s no-heredoc rule, and a silent non-match followed. After the tour, the user's conceptual questions (how a model uses the client; how auth works when deployed) showed the tour explained the code but not where it sits in the whole system. A layer diagram up front would have answered them. |
