# AGENTS.md: catalog-agent

Instructions for any AI coding assistant working in this repo. This file is loaded every session, so it stays short. Detail lives in `REQUIREMENTS.md` and `docs/`, read when needed. How this context system works: `docs/ai-workflow.md`.

## Overview
Two things in TypeScript, built in two phases, on top of the product catalogue from the sister repo [product-catalog](https://github.com/AbanobNageh/product-catalog) (local copy `D:\Projects\product-catalog`):
1. **Phase 1 (M0–M4): an MCP server** that exposes catalog-api as tools for any MCP client (Claude Code, Claude Desktop, MCP Inspector). No LLM calls, no LLM cost.
2. **Phase 2 (M5–M8): a tool-calling agent loop** that uses the Phase 1 server through an MCP client, with OpenRouter models, three test layers and real-model evals.

The MCP server is an ordinary HTTP client of catalog-api **`v1.1.0`**, built from that git tag. It never changes product-catalog. It's a portfolio piece for remote backend roles. The spec is `REQUIREMENTS.md` (sections are cited as §n). Current state: `docs/STATUS.md`.

## The builder
- Backend engineer, about 5.5 years. Strong in TypeScript/Node.js (NestJS), Go, PostgreSQL, Redis and OpenSearch, so skip the basics there.
- **New to MCP and agent loops as a builder.** Define every MCP concept (tools, resources, prompts, transports, `structuredContent`, annotations, …) and every agent-loop concept on first use, in the reply and in a brief code comment. The user must be able to explain every part of this repo in an interview.

## Setup
- Host: Windows 11, Docker Desktop (WSL2, 16 GB to Docker). Give **PowerShell 5.1** commands.
- Installed: Node 24.21, npm 11.19, Docker 29.8 with Compose 5.6, gh 2.93, Go 1.26. Not installed yet: gitleaks (needed at M4).
- **Memory:** product-catalog's Compose stack, its kind clusters (dev and staging, about 7 GiB together) and this repo's stack don't all fit. Check `docker ps` before starting this stack, and ask before stopping anything of product-catalog's.

## Commands
Run from the repo root. Test every command before it goes here.

Node (ADR-0002: TypeScript 7, Vitest 5, oxlint, Prettier; exact pins via `.npmrc`):
- Install: `npm ci`. Add a package: `npm i <pkg>@<exact version>` (`save-exact` is on; the version comes from the milestone's ADR)
- Local env: `Copy-Item .env.example .env` (git-ignored; the read key by default)
- Tests: `npm test` (Vitest, `src/**/*.test.ts`)
- Typecheck / lint / format: `npm run typecheck` / `npm run lint` (type-aware; fails on `console.log`/`info`/`debug` in `src/`) / `npm run format:check` (`npm run format` fixes; `*.md` is formatted by hand)
- Build to `dist/`: `npm run build`
- CI (`.github/workflows/ci.yml`) runs `npm ci`, lint, typecheck, format check, test and build. Until the repo is on GitHub (M4), run those locally

The catalogue stack (`docker-compose.yml`, project `catalog-agent`, catalog-api `v1.1.0` built from product-catalog's git tag; ADR-0003):
- First start, or after changing the tag: `docker compose up --build -d --wait`. It clones the tag (needs the network) and takes about 3 minutes, plus the 1.2 GB OpenSearch image if it isn't pulled yet
- Later starts: `docker compose up -d --wait` (about 20 s). Without `--wait`, the command returns while catalog-api is still starting, and an immediate request gets an empty reply
- Check: `docker compose ps -a` (all `healthy`; `migrate` shows `Exited (0)`, because it applies migrations and exits). Only catalog-api has a host port: http://localhost:3100 (Swagger at `/docs`, OpenAPI JSON at `/docs-json`)
- Seed 10,000 products (`SEED-00001`…), then reindex. It needs the admin key; re-running is safe: `docker compose run --rm -e CATALOG_API_URL=http://catalog-api:3000 -e CATALOG_API_KEY=dev-admin-key-not-secret-000000000000000 catalog-api node dist/seed/main.js`
- Smoke search: `curl.exe -s "http://localhost:3100/products/search?maxStock=5&sort=stock_asc" -H "Authorization: Bearer dev-read-key-not-secret-0000000000000000"`. No key: 401; too low a scope: 403
- Logs: `docker compose logs -f catalog-api search-service`
- Stop: `docker compose stop` (the data stays). `docker compose down -v` deletes the volumes, so only with the user's go-ahead
- Memory when idle: about 1.8 GiB (OpenSearch 1.5 GiB)

## Who writes what
- **The AI** writes the code, tests, config and docs, and explains them.
- **The user** makes the design decisions, reviews every milestone, runs the checks, and does everything outward-facing (GitHub repo, pushes, secrets, OpenRouter keys).
- This split is recorded honestly in the README ("who did what" and a log of the AI's mistakes), as in product-catalog.

## Rules
- One milestone at a time (§7). No scope beyond the plan without asking.
- **Check the official docs at the start of each milestone** (MCP spec and TypeScript SDK, OpenRouter's API and model prices, npm versions) and warn the user when `REQUIREMENTS.md` is outdated. Most MCP tutorials online are for SDK v1; this repo uses v2 (ADR-0002).
- **stdout is the MCP protocol** on stdio. Logs go to stderr as structured JSON. Never `console.log` in `src/`.
- **Never put the catalog API key, the OpenRouter key, a stack trace or a full upstream body** in a log line, a tool result, an error message, a trace or a commit.
- The agent never gets `DELETE /products/:id` or `POST /admin/reindex`. Writes are never blindly retried (§4.4).
- Don't guess at gaps in the spec. Write `[NEEDS CLARIFICATION: ...]` and ask.
- A real decision (a choice between alternatives someone might question) gets a proposed ADR in `docs/adr/`.
- **Never without the user's go-ahead in that moment:** push or publish anything, create the GitHub repo, add secrets, run real-model evals or anything else that spends OpenRouter credit (beyond one approved smoke call per milestone), delete Docker volumes (`down -v`), touch product-catalog (including stopping its stack or clusters).
- PowerShell 5.1 gotchas (§9): `curl.exe` drops embedded double quotes (put `If-Match` headers in a file, `-H @file`, or test from Node); commit with `git commit -F <file>`; edit files with the Edit/Write tools, never `Set-Content`/`Out-File` or shell heredocs; never pipe a long-running command into `Select-Object -First N`.

## Session routine
- **Start:** `docs/STATUS.md` is already in context. Run `git log --oneline -10` and read the current milestone's plan in `docs/milestones/` (or its row in §7 if there's no plan yet). Restate in 3 lines or fewer: current milestone, last thing done, next step. If something is already built or running, smoke-check it first (`docker compose ps`, `npm test`).
- **Milestone flow (§9):** read the code and docs → ask the real decisions, one set at a time → a proposed ADR for each real choice → a plan in `docs/milestones/` with a Review Focus → build test-first, committing nothing → a fresh reviewer checks the whole uncommitted diff → re-grade its findings by their real effect and fix them (test-first for code) → close.
- **During:** keep the "Now" block of `docs/STATUS.md` current when the next step changes.
- **At a "Done when" check:** follow `.claude/skills/close-milestone/SKILL.md`. The user's short approvals ("close it", "go ahead") mean: commit, and accept the milestone's ADRs.

## Where things live
| Path | What | Owner and edit rule |
|---|---|---|
| `REQUIREMENTS.md` | The spec: what to build, the catalog-api contract, milestones | The user. The AI proposes changes and applies them only after approval |
| `AGENTS.md`, `CLAUDE.md`, `.claude/` | Instructions, settings, skills | The user, same rule. Exception: the AI fills in **Commands** above as it builds |
| `docs/STATUS.md` | Current state and checklist | The AI. Rewrite "Now"; the checklist is tick-only |
| `docs/milestones/` | One plan and one note per milestone | The AI writes; frozen once committed |
| `docs/adr/` | Architecture decision records, numbered from 0001 in this repo | Append-only. A changed decision gets a new ADR that supersedes the old one. product-catalog's are cited as "product-catalog ADR-00nn" |
| `docs/ai-workflow.md` | How this context system works, plus the experiment log | The AI drafts and appends to the log; the user approves |
