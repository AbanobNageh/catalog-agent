# Status

> Edit rules: the AI rewrites **Now** whenever the next step changes. The **Checklist** is tick-only: change `[ ]` to `[x]` and append `· date · commit · note link`. Never reword, reorder or delete items without asking.

## Now
- **Current:** M4 Phase 1 release. Not started; no plan yet.
  - **§7's "Done when":** README (§8), the §4.6 demo, tag `v0.1.0`, gitleaks clean.
  - **The user** creates the GitHub repo and pushes, at that moment, after their go-ahead.
  - **The AI** proposes the README link for product-catalog: a proposal only, never an edit there.
  - **After M4:** the end of Phase 1, so `close-milestone` step 10 proposes cuts to `AGENTS.md`.
- **Last session:** 2026-10-26. Closed M0–M3 ([M3 note](milestones/2026-10-26-M3-write-tools.md)).
  - **M3 added three write tools,** `create_product`, `set_price` and `set_stock`, behind `CATALOG_ACCESS=read|write`. [ADR-0006](adr/0006-write-tools.md) is accepted.
    - **The set tools:** `expectedVersion` and `dryRun` are required; every call reads the product first; a no-op writes nothing; the cancel signal is checked before any `PATCH`.
    - **`create_product`** is never retried, and has its own outcome-unknown hint.
  - **Tests:** 326 unit tests (MCP-level in both eras) and 61 integration tests (about 105 s).
  - **Checked live** in Inspector and in Claude Code (dry run, apply, a planted `STALE_VERSION`).
- **Running:**
  - the `catalog-agent` Compose stack on :3100, seeded
  - **the user's `.env` now has the write key and `CATALOG_ACCESS=write`** (set during the M3 demo). `.env.example` still has read/read
  - demo products `IT-DEMO-M3-1..3` (category `it-demo-m3`: Demo-Notebook, now at stock 50; Demo-Pencil-Case at 0; Demo-Planner at 8). Reuse them for M4's demo, then delete them with the admin key
- **Next step: start M4,** following the milestone flow in `AGENTS.md`.
  1. **Check the official docs first:**
     - gitleaks: the current release, and how to install it on Windows (for example `go install github.com/zricethezav/gitleaks/v8@<version>`, since Go 1.26 is installed, or winget/scoop)
     - the GitHub Actions versions in `.github/workflows/ci.yml`
     - `npm view @modelcontextprotocol/server versions` (2.4.0 at M3) and the MCP spec's revision
     - the MIT licence text
  2. **Read first:**
     - `REQUIREMENTS.md` §8 (the README rules: a recruiter part first, who did what, the AI's mistakes) and §4.6 (the demo)
     - the M0–M3 notes (`docs/milestones/*-M?-*.md`, their "Review findings" and "the AI's own mistakes") and the experiment log in `docs/ai-workflow.md`: the README's log of the AI's mistakes is built from them
     - `docs/adr/` 0001–0006, for the README's design section
  3. **Likely decisions to ask the user:**
     - **The demo format:** a transcript or a GIF (§4.6), and who records it (the user, in Claude Code).
     - **The demo's products:** §4.6 says "finds low-stock books", which are `SEED-*` products. The tests never write `SEED-*`, but would the demo restock one, or use `it-demo-*` products? A restock writes the shared seed data.
     - **The version bump:** `0.1.0` in `package.json` and `SERVER_INFO` (`src/mcp/server.ts`).
     - **The README's length and structure.** The production section covers:
       - Streamable HTTP with OAuth 2.1 (read the 2026-07-28 authorization section first)
       - idempotency keys or a lookup by SKU for create
       - catalog-api's cache caveat (ADR-0006)
       - an error schema once the spec has one (SEP-2145)
     - **The `REQUIREMENTS.md` updates** listed below, for the user to approve.
  4. **Write the plan** (`docs/milestones/<date>-M4-plan.md`) with a Review Focus. Build, then the fresh reviewer (give it the uncommitted diff and the plan; **mutate only a temp copy, with absolute paths**; **skip `pause.int.test.ts` while a demo is live**). Then `close-milestone`: gitleaks over all history, then stop. Creating the repo, pushing and tagging are the user's.
- **Carried into M4:**
  - **CI green on GitHub** at the first push. Check the `integration` job's run time, now about 105 s of tests plus the stack build; its stdio and `.env` tests build `dist/` and use a `node_modules` junction or symlink.
  - **gitleaks** over all history, and the MIT `LICENSE`. Check that no `.env`, key or trace file was ever committed.
  - **The README:**
    - who did what, and the AI's mistakes (from the milestone notes)
    - §4.6's demo transcript: capture whether Claude Code asks for approval before each write tool, and the model's wording after `STALE_VERSION`
    - the `.env` step before Claude Code, **as the first numbered step** (M2 and M3 both tripped on it)
    - "two layers" of least privilege (`CATALOG_ACCESS` and the key's scope), and why delete and reindex are never exposed
    - a set call's worst case: about 11 × `CATALOG_TIMEOUT_MS`, 57 s at the default
    - "what I'd change in production" (see above)
  - **Delete the demo products** after the demo.
- **Carried into M5:** the per-call timeout must allow about 11 × `CATALOG_TIMEOUT_MS` for a set call.
- **Carried into M6:**
  - log the calls the SDK rejects before our handler (schema errors, unknown tools); today they get no `tool call` line
  - consider a bound on a set call's total time
- **Later:** a sweep command for `it-*` products left by a killed integration run.
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
  - **The SDK:**
    - it drops in-flight requests when stdin reaches end-of-file
    - `StdioClientTransport` tolerates junk on stdout (only the raw-pipe test catches it)
    - an unknown tool is a JSON-RPC `-32602` protocol error, not a tool result
    - the handler's `ctx.mcpReq.signal` aborts on cancellation, in both eras
    - the client's default request timeout is 60 s
  - **Inspector:** it validates `structuredContent` even on `isError`. Its CLI uses the SDK client's 60 s default timeout.
  - **Claude Code** starts project servers in the repo folder, and reads `.env` only when the server starts: reconnect with `/mcp` after editing it.
  - **Tests:** keep test client timeouts well clear of 1 s.
- **Outdated in `REQUIREMENTS.md`** (to propose to the user):
  - **the MCP spec** is revision 2026-07-28, and the SDK is v2 (ADR-0002)
  - **§3.2:** list items carry `version`
  - **§4.2:**
    - "a short text summary" is now a summary plus the JSON (ADR-0005)
    - it doesn't say `dryRun` is required (ADR-0006)
  - **§4.3:** error results are text only, and the SDK's schema rejections are plain text (ADR-0005)
  - **§4.4:** the create hint "search for the sku" can't be followed; see ADR-0006 for the wording used
- **Session gotchas:**
  - commit with `git commit -F <file>`, and stage explicit paths only
  - edit files with the Edit/Write tools only: no heredocs, no inline Python, no .NET `WriteAllText`, no `Set-Content`
  - run `npm run typecheck` after every change; check lint by its exit code
  - **`npm run format` re-wraps lines,** so re-read a file before an Edit after formatting
  - if `npm run test:int` says "The build failed", fix the tsc errors it printed
  - never import from a `*.test.ts` file into another test file: Vitest would run its tests there too
- **Open questions / blockers:** none.

## Checklist
### Phase 1: the MCP server (§4)
- [x] M0 Scaffold · 2026-10-26 · 006e630..f548fd0 · [note](milestones/2026-10-26-M0-scaffold.md)
- [x] M1 Catalog client · 2026-10-26 · d1055ae..15bbe9f · [note](milestones/2026-10-26-M1-catalog-client.md)
- [x] M2 MCP server, read tools · 2026-10-26 · d2a2a68..63b32eb · [note](milestones/2026-10-26-M2-mcp-read-tools.md)
- [x] M3 Write tools · 2026-10-26 · f12f571..3b83da6 · [note](milestones/2026-10-26-M3-write-tools.md)
- [ ] M4 Phase 1 release

### Phase 2: the agent loop (§5; starts only after Phase 1 is published and the user says go)
- [ ] M5 Agent loop
- [ ] M6 Robustness
- [ ] M7 Evals
- [ ] M8 Phase 2 release
