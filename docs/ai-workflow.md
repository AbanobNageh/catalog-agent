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

## What the review loop caught
The details are in each [milestone note](milestones/)'s "Review findings and corrections". The ones that matter most:

- **What I caught, or decided differently:**
  - **M2:** my demo in MCP Inspector showed that the first error results broke the spec: structured errors that didn't match the output schema, which the SDK's own client had hidden. I asked how well-known servers handle errors before deciding ([ADR-0005](adr/0005-mcp-tool-results-and-errors.md)).
  - **M3:** I chose writes on by default, against the AI's recommendation ([ADR-0006](adr/0006-write-tools.md)).
  - **M4:**
    - I had the demo re-recorded outside the repo and without auto-approval, after the first take showed no approval prompts and a model reading this repo's notes.
    - I had the README cut to a landing page, with the detail moved to [how-it-works.md](how-it-works.md).
- **The AI's mistakes, found by the fresh reviewer:**
  - **M0:** a key-leak path product-catalog had already closed (a key with a line break, echoed in `fetch`'s error message).
  - **M1:** a test the plan claimed but that didn't exist, and wrong numbers in an ADR.
  - **M2:** a key echoed inside an upstream JSON message could reach a tool result.
  - **M3:**
    - a cancelled set call still wrote
    - a create hint that could lead the model to a duplicate product
  - **M4:**
    - the README claimed all 61 integration tests ran through the stdio server (about 30 do)
    - it credited me with corrections the notes credit to the reviewer
    - CI would have failed at the first push, because it never seeded the stack
- **The AI's mistakes, found by itself or in my demos:**
  - **M1:** a pause test that could pass for the wrong reason (its timeout was below a normal write's latency), and a wrong first diagnosis of the flake.
  - **M2:**
    - a hole in its own fix for the echoed key: the message was cut before the key was replaced, which could leave part of it
    - error results built on the SDK's behaviour without checking a second client
    - setup instructions that claimed a default key that doesn't exist
  - **M3:** a `.env` step left in prose before the numbered demo steps, which I skipped, as in M2.
  - **Throughout:**
    - some tests written after the code, so they were proven by mutation instead of failing first
    - several breaks of its own working rules (shell heredocs, `Set-Content`), one of which silently failed to apply an edit

## Experiment log
One line per milestone: what the context system helped with, or got wrong.

| Date | Milestone | Observation |
|---|---|---|
| 2026-10-26 | M0 | The system was built during this milestone, so no fresh session has used it yet. Helped: "check the official docs at each milestone" (carried over from product-catalog) found the stateless 2026-07-28 MCP spec and the split v2 SDK before any code, which turned the toolchain into four questions the user answered in one round. Running every command before it went into `AGENTS.md` caught `up -d` returning before catalog-api was healthy. The fresh reviewer, given only the plan and the tree, found the most important defect: a key-leak path through `fetch` errors that product-catalog had already closed and the AI didn't carry over. Missed: ADR-0001 and this page overclaimed what the permission rules enforce. The `close-milestone` skill inherited a step order that left the log line out of the close commit. After it was fixed on disk, invoking the skill still loaded the copy from the session start, so the AI followed the file instead. |
| 2026-10-26 | M1 | Run in the same session as M0's close, with no `/clear` in between. Helped: the milestone flow put the timeout-simulation question in front of the user before any code. Reading catalog-api's code at the tag first found a fact no test would have shown: it commits before its index call, so a paused search-service gives a real late answer. Mutation checks (break a rule, see a test fail) gave the confirm logic evidence beyond "tests pass". The fresh reviewer found the milestone's one Important defect: a plain failure reported after an ambiguous write. It also found a claimed test that didn't exist, which it proved with a mutation. Missed: the AI's first pause test could pass for the wrong reason (a timeout below the normal write latency), its first diagnosis of the resulting flake was wrong, and ADR-0004 shipped wrong numbers until the review. While fixing the review, the AI broke `AGENTS.md`'s no-heredoc rule, and a silent non-match followed. After the tour, the user's conceptual questions (how a model uses the client; how auth works when deployed) showed the tour explained the code but not where it sits in the whole system. A layer diagram up front would have answered them. |
| 2026-10-26 | M2 | Started after a compaction. STATUS's M2 brief was enough to resume without re-reading the transcript. Helped: "check the official docs first" plus reading the SDK's own code and a throwaway spike settled the era question, the validation behaviour and the timeout before any code, which turned them into four questions the user answered in one round. Demo checks with real clients found what the in-process tests couldn't: Inspector rejects structured errors (the SDK's own client and server don't), and Claude Code needs a `.env`. The user asked how well-known servers handle errors before deciding, and a research agent's source reading turned a guess into evidence; the AI checked its two key citations. The fresh reviewer again found what the AI's own sweep missed: the key could leak through a JSON message, and the `.env` location was untested. Missed: the AI's Claude Code instructions were wrong (no default key); it wrote `main.ts` before its test; and the reviewer wrote one mutation into the working tree. Briefs now say "mutate only a temp copy, with absolute paths". |
| 2026-10-26 | M3 | Started after a compaction. STATUS's M3 brief named the six decisions to expect, and five of them came up as forecast. Helped: the M2 memory ("research how well-known servers do it before asking") turned three open MCP conventions (read-only switches, write annotations, no-ops) into one evidence-backed round of questions. Reading catalog-api's code at the tag found what `/docs-json` hides (no string bounds, `If-Match`'s range, `q` never searching `sku`), which made §4.4's create hint impossible to follow before any code. The "mutate only a temp copy" brief worked: the reviewer stayed in its copy. It found what the AI's own sweep missed: a cancelled call still wrote, a stale-cache path, and a create hint that could lead to a duplicate. Running the review during the user's demo saved time, but the reviewer had to be told to skip the pause test. Missed: the AI's demo instructions put the `.env` step in prose before the prompts, so the user hit a 403, the same trap as M2. The integration tests came after the code, so they were proven by mutation. |
| 2026-10-26 | M4 | Continued after a compaction. STATUS's M4 brief named the decisions to expect, and the user answered them in two rounds. Helped: the "config first" memory put the `.env` check and the build at step 1 of the demo steps, and no take failed on configuration. Reading the demo session's own log, not just `/export`, gave an exact transcript and settled an M2 unknown: Claude Code forwards only `structuredContent` on success. The fresh reviewer, working from a fresh copy, found what the AI's own checks missed: a headline test claim that was false for half the tests, a "who did what" line the notes contradict, and a CI job that would have failed at the first push for want of a seed. Missed: the AI's demo steps didn't say to leave auto mode or the repo, so the first full recording showed no approval prompts and a model quoting `STATUS.md`. The user caught that, and later that the README was too long to read. Both changes made the release better. |
