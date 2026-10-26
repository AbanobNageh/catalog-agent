# Status

> Edit rules: the AI rewrites **Now** whenever the next step changes. The **Checklist** is tick-only: change `[ ]` to `[x]` and append `· date · commit · note link`. Never reword, reorder or delete items without asking.

## Now
- **Current:** **Phase 1 is published** (M4, [note](milestones/2026-10-26-M4-phase-1-release.md)).
  - **Done by the AI at the user's go-ahead (2026-10-26):**
    - created https://github.com/AbanobNageh/catalog-agent (public, with the description and topics), and pushed `main`
    - CI was green on the first push: `check` 15 s, `integration` 3 min 41 s (stack build 1:36, seed 0:11, tests 1:45)
    - tagged and pushed `v0.1.0`, an annotated tag on `74b4f9b`
  - **The user's choices:**
    - `integration` stays on every pull request (§6)
    - the five `AGENTS.md` changes for the end of Phase 1 are applied
    - the AI edited product-catalog's README line 18, linking this repo
- **Phase 2 (M5–M8)** starts only when the user says go (§5). M5 is the agent loop: OpenRouter `ChatModel`, `FakeChatModel`, the loop, the approval gate, limits, traces, the CLI, unit tests. **Check first:** OpenRouter's API and model prices, the SDK client version. One approved smoke call per milestone at most.
- **Last session:** 2026-10-26. Closed M0–M4.
  - **M4:** the README (a landing page), `docs/how-it-works.md`, the §4.6 demo (`docs/demo/`: the user's GIF and a transcript), MIT `LICENSE`, version 0.1.0, `.gitleaks.toml`, the CI seed step, and six approved `REQUIREMENTS.md` edits.
  - **Tests:** 327 unit, 61 integration (105 s).
- **Running:**
  - the `catalog-agent` Compose stack on :3100, seeded: exactly the 10,000 seed products. The demo left `SEED-04007` at stock 40 and `SEED-04575` at 25
  - **the user's `.env`** has the write key and `CATALOG_ACCESS=write`; `.env.example` has read/read
  - gitleaks 8.30.1 (winget): `gitleaks git --redact .` and `gitleaks dir --redact .`
  - `D:\Projects\catalog-demo` (outside the repo): the demo's MCP config and the raw `/export`. The user can delete it
- **Carried into M5:**
  - the per-call timeout must allow about 11 × `CATALOG_TIMEOUT_MS` plus 2 s for a set call
  - our loop decides what the model sees from a result. Claude Code forwards only `structuredContent` on a success, and the text on an error
- **Carried into M6:**
  - log the calls the SDK rejects before our handler (schema errors, unknown tools); today they get no `tool call` line
  - consider a bound on a set call's total time
- **Later:**
  - a sweep command for `it-*` products left by a killed integration run
  - optionally, a gitleaks job in CI
- **Facts worth remembering:**
  - **catalog-api:**
    - a write takes about 1 s, a read a few ms
    - a `PATCH` commits before its Redis and index calls, so its answer can come up to about 3 s later
    - every `PATCH` raises the version, even one that changes nothing
    - `GET /products/:id` is cached in Redis for 5 minutes, and `RedisCache.del` swallows its errors
    - `If-Match` takes versions 1 to int32 max
    - the create DTO has no maximum string lengths
    - filters are case-sensitive; `relevance` without `q` is `newest`; `q` searches `name^3` and `description` only, never `sku`
    - facets are the top 20 categories and the top 50 brands
    - the seed skips existing SKUs, so re-seeding never resets a changed row
  - **The SDK:**
    - it drops in-flight requests when stdin reaches end-of-file
    - `StdioClientTransport` tolerates junk on stdout (only the raw-pipe test catches it)
    - an unknown tool is a JSON-RPC `-32602` protocol error, not a tool result
    - the handler's `ctx.mcpReq.signal` aborts on cancellation, in both eras
    - the client's default request timeout is 60 s
  - **Inspector:** it validates `structuredContent` even on `isError`. Its CLI uses the SDK client's 60 s default timeout.
  - **Claude Code** (v2.1.310):
    - it starts project servers in the repo folder, and reads `.env` only when the server starts: reconnect with `/mcp` after editing it
    - in manual mode it asks before every MCP tool call, read-only tools and dry runs included
    - `--mcp-config <file> --strict-mcp-config` runs a session outside the repo with only that server
    - `/export` folds tool calls; the session log in `~/.claude/projects/` has them in full
  - **Tests:** keep test client timeouts well clear of 1 s.
- **Session gotchas:**
  - commit with `git commit -F <file>`, and stage explicit paths only
  - edit files with the Edit/Write tools only: no heredocs, no inline Python, no .NET `WriteAllText`, no `Set-Content`
  - run `npm run typecheck` after every change; check lint by its exit code
  - **`npm run format` re-wraps lines,** so re-read a file before an Edit after formatting
  - if `npm run test:int` says "The build failed", fix the tsc errors it printed
  - never import from a `*.test.ts` file into another test file: Vitest would run its tests there too
  - in PowerShell strings, write `${id}:` rather than `$id:`
- **Open questions / blockers:** none.

## Checklist
### Phase 1: the MCP server (§4)
- [x] M0 Scaffold · 2026-10-26 · 006e630..f548fd0 · [note](milestones/2026-10-26-M0-scaffold.md)
- [x] M1 Catalog client · 2026-10-26 · d1055ae..15bbe9f · [note](milestones/2026-10-26-M1-catalog-client.md)
- [x] M2 MCP server, read tools · 2026-10-26 · d2a2a68..63b32eb · [note](milestones/2026-10-26-M2-mcp-read-tools.md)
- [x] M3 Write tools · 2026-10-26 · f12f571..3b83da6 · [note](milestones/2026-10-26-M3-write-tools.md)
- [x] M4 Phase 1 release · 2026-10-26 · 2a0d6a3..6b1d6c9 · [note](milestones/2026-10-26-M4-phase-1-release.md)

### Phase 2: the agent loop (§5; starts only after Phase 1 is published and the user says go)
- [ ] M5 Agent loop
- [ ] M6 Robustness
- [ ] M7 Evals
- [ ] M8 Phase 2 release
