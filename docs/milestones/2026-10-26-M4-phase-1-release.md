# M4 Phase 1 release
- Date: 2026-10-26 · Commits: 2a0d6a3, fb497ed, 6b1d6c9 · Plan: [2026-10-26-M4-plan.md](2026-10-26-M4-plan.md) · Design: no new ADR

## What was built
- **`README.md`:** a landing page of 109 lines.
  - **The recruiter part:** what it is, the status, who did what, proof links.
  - **The demo GIF.**
  - **The technical part:**
    - the architecture diagram
    - Run it (`.env` as step 1) and an Inspector example
    - a tool table, plus one paragraph each on errors, reliability and production
    - the ADR table
    - how the AI was used
- **`docs/how-it-works.md`:** the detail the README links to:
  - the MCP basics
  - the tools and the two privilege layers
  - the error table with the real hints
  - the reliability rules and the tests
  - what Claude Code does with the server
  - what I'd change in production
  - the repository map
- **`docs/demo/`:** `restock.gif` (the user's recording, 3.8 MB, 96 s) and `transcript.md`.
  - The model's words come from Claude Code's `/export`.
  - The tool calls and results come from the session's log, with every cut marked.
- **`docs/ai-workflow.md`:** a new section, "What the review loop caught": the user's catches and the AI's mistakes, by milestone.
- **`LICENSE`:** MIT.
- **Version 0.1.0:** in `package.json`, the lockfile and `SERVER_INFO`, with a new unit test that `SERVER_INFO` equals `package.json`.
- **`.gitleaks.toml`:** the default rules, plus an allowlist anchored to exactly the three public dev keys. gitleaks 8.30.1 was installed with winget. `AGENTS.md` Commands has the scan.
- **CI:** the `integration` job seeds the stack before the tests.
- **`REQUIREMENTS.md`:** the six outdated spots updated, as approved (SDK v2 and the spec revision, list items' `version`, the text block, a required `dryRun`, text-only errors, create's hint).
- **Verified, 2026-10-26:**
  - **The suites:** 327 unit tests (up from 326) and 61 integration tests (105 s) pass; typecheck, lint, format and build are clean.
  - **The README's commands,** run live: Inspector in read and write mode (`tools/list`, a search, `get_product`, a dry run), and the CI seed line.
  - **gitleaks:** "no leaks found" over the whole history (19 commits) and the working tree. A probe showed that a near-copy of a dev key, and a random key, are still reported.
  - **Never committed:** of the 83 files ever added, the only `.env*` is `.env.example`. No key files, `traces/` or `evals/runs/`.
  - **Clean-up:** the M3 demo products were deleted; the catalogue is back to its 10,000 seed products. The demo restocked `SEED-04007` (40) and `SEED-04575` (25), as the transcript says.
  - **Not yet:** CI on GitHub and the `v0.1.0` tag. Both come at the user's push.

## Decisions
- **The user's choices (2026-10-26):**
  - **The demo:** a GIF and a transcript. The AI had recommended a transcript only.
  - **Its data:** `SEED` books, as §4.6 says.
  - **The README:** first mirroring product-catalog's. After the tour, the user had it cut to a landing page, with the detail in `docs/how-it-works.md`.
  - **gitleaks:** installed with winget.
  - **`REQUIREMENTS.md`:** all six edits applied.
  - **The prompts:** pasted from a helper script, at the user's question.
  - **A clean take:** the demo was re-recorded outside the repo and in manual mode (the user's idea). Between takes, the two books were set back to stock 0, rather than reset with `down -v`.
- **The AI's rulings:** the plan's ledger, 12 entries. Among them:
  - no new ADR
  - `SERVER_INFO` stays a constant, kept equal by a test
  - the plant is run from a separate window
  - the transcript draws on the session log, because `/export` folds the tool calls
  - the gitleaks allowlist is anchored to exact strings, not fingerprints
- **Facts found** (Claude Code v2.1.310, the demo and its docs):
  - **It asks before every MCP tool call** in manual mode, read-only tools and dry runs included. Its docs say `readOnlyHint` lets read-only calls run in parallel, and `idempotentHint` lets it re-send a pending call after a dropped connection, for HTTP servers only.
  - **On a success, it passes the model only the `structuredContent` JSON;** on an error, the text. This settles M2's open question.
  - **The MCP spec (2026-07-28)** says a stdio server takes its credentials from the environment, and a remote one is an OAuth 2.1 resource server that must not pass tokens through. SEP-2145 (an error schema) is still in review.
  - **No change** to the SDK (2.4.0), Inspector (2.12.0) or the CI actions (`@v7`).

## Review findings and corrections
- **The fresh reviewer** worked from a fresh copy of the tree.
  - **What it ran:** every suite, every README command (`npm ci`, build, Inspector in both modes), gitleaks with and without the allowlist, and a version mutation.
  - **What it compared:** the transcript, line by line, against the raw export and the session log; it also viewed frames of the GIF.
  - **Its result:** 0 Critical, 3 Important and 9 Minor findings. It changed nothing in the repo. The plan re-grades each one.
  1. **The README claimed all 61 integration tests run through the stdio server.** About 30 do. **Fixed:** the claim says "about half", and the tests are split by kind.
  2. **"Who did what" said the user asked for the corrections in each note.** The notes credit the reviewer and the AI. **Fixed:** "Reviewed every milestone"; the user's own catches are listed separately.
  3. **CI never seeded the stack,** so the stdio tests, which search the seed's books, would fail at the first push. This was pre-existing since M2, and the job has never run. **Fixed:** a seed step, run here as written. It is proven only at the push.
  4. **Minor, all fixed:**
     - an exception left out of the "no plain failure" rule
     - the 57 s arithmetic (plus 2 s), and whose 60 s timeout it is
     - connection errors left out of the re-read triggers
     - one of the AI's own finds credited to the reviewer
     - a decision listed as a catch
     - the transcript's 10,003 products unexplained
     - `list_facets` left out of the prompted tools
     - a comment crediting the demo for something from the docs
     - stale text in STATUS and `server.ts`
  5. **From its "could not verify" list:** "Claude Desktop" in the README had never been tested. Now it says "tested with Claude Code and MCP Inspector".
- **The user's review:**
  - **The first full take** ran in auto mode inside the repo: no approval prompts, and the model quoted `STATUS.md`. The user proposed recording again outside the repo, in manual mode. That take showed the prompts, the finding above.
  - **The README was "way too long, no one will read all of that"**, with information that belonged in other files. It is now a landing page; the detail moved to `docs/how-it-works.md` and `docs/ai-workflow.md`.
  - **The user confirmed** that the plant came from the helper script, and that every prompt got a one-time "Yes".
- **The AI's own mistakes:**
  - **Its first demo steps** didn't say to leave auto mode or to run outside the repo. So the first full recording showed neither the approval prompts nor a clean model context.
  - **Its first README draft** paraphrased the hints, and its `SKU_EXISTS` row gave the wrong advice. It caught this by re-reading `results.ts` before the review.
  - **The three Important findings above** were its own claims and gaps. The missing CI seed dates from M1–M2, when it wrote the job and the stdio tests.
  - **A PowerShell command failed to parse** (`"$id:"`), and it re-ran it with `${id}`.

## Follow-ups
- **At the push** (done by the AI at the user's go-ahead on 2026-10-26, as an exception to "the user creates the repo and pushes"; the user also had the README's "Outward" row removed, since the README is about the repo, not who pushed it):
  1. Create `AbanobNageh/catalog-agent` (public), with the description and topics proposed in chat:
     - **Description:** "An MCP server for a product catalogue: bounded tools, version-checked writes with dry runs, recoverable errors, tests without an LLM. TypeScript, MCP SDK v2, built with Claude Code."
     - **Topics:** `mcp`, `model-context-protocol`, `mcp-server`, `typescript`, `nodejs`, `ai-agents`, `tool-calling`, `claude-code`, `optimistic-concurrency`, `docker-compose`
     - **Proposed product-catalog README link** (line 18, after the push): "A separate repo (an MCP server and a tool-calling agent) will build on that tag." → "**[catalog-agent](https://github.com/AbanobNageh/catalog-agent)** builds on that tag: an MCP server (released as v0.1.0), and next a tool-calling agent with evals."
  2. Push `main`.
  3. Check CI green: record the `integration` job's run time, and decide whether it stays on every pull request (§6).
  4. Tag `v0.1.0` and push the tag.
- **Proposals, text only:**
  - the product-catalog README link, after the push
  - the `AGENTS.md` cuts for the end of Phase 1
- **Optional:** a gitleaks job in CI (§6 says "before each publish"); today it is a manual step.
- **M5:**
  - the per-call timeout must allow about 11 × `CATALOG_TIMEOUT_MS` plus 2 s for a set call
  - our own loop decides what the model sees from a result: Claude Code forwards only `structuredContent` on success
- **M6:**
  - log the calls the SDK rejects
  - consider a bound on a set call's total time
- **Later:**
  - a sweep command for `it-*` products
  - `D:\Projects\catalog-demo` (the demo's config and raw export, outside the repo) can be deleted by the user
