# Status

> Edit rules: the AI rewrites **Now** whenever the next step changes. The **Checklist** is tick-only: change `[ ]` to `[x]` and append `· date · commit · note link`. Never reword, reorder or delete items without asking.

## Now
- **Current:** M3 Write tools (§4.2's write rows, §4.3 and §4.4 through the tools, §4.5's write integration tests, the M3 row of §7). Not started; no plan yet.
- **Last session:** 2026-10-26. Closed M0, M1 and M2 ([M2 note](milestones/2026-10-26-M2-mcp-read-tools.md)).
  - **M2 built a stdio MCP server** (`src/main.ts`, `src/mcp/`) with three read tools, `search_products`, `get_product` and `list_facets`, on M1's `CatalogClient`. [ADR-0005](adr/0005-mcp-tool-results-and-errors.md) is accepted.
  - **Tests:** 210 unit tests (the MCP-level suite in both eras) and 42 integration tests (stdio, tools, `.env`, the contract check).
  - **Checked live:** it works in MCP Inspector and in Claude Code through `.mcp.json`.
  - **Running:** the `catalog-agent` Compose stack on :3100, seeded. `.env` exists, a copy of `.env.example` with the read key. The user asked to compact after the M2 close.
- **Next step: start M3,** following the milestone flow in `AGENTS.md`.
  1. **Check the official docs first.** SDK v2 at https://ts.sdk.modelcontextprotocol.io/v2/, for write-tool annotations (`destructiveHint`, `idempotentHint`) and anything new since 2.4.0 (`npm view @modelcontextprotocol/server versions`).
  2. **Read the M2 code first:**
     - `src/mcp/results.ts`: `errorData` / `toolError` already hold every §4.3 hint, including "the change may have been applied; read the product before retrying"
     - `src/mcp/tool-call.ts` (`runTool`)
     - `src/mcp/schemas.ts`
     - `src/mcp/server.ts`
     - `src/testing/{mcp,stdio,fixtures}.ts`
  3. **Likely decisions to ask the user:**
     - **`CATALOG_ACCESS`:** its default (`read`?), and how `.mcp.json` sets it. `.mcp.json` env would override `.env`, because variables already set win.
     - **`dryRun`'s output shape:** §4.2 says `{ current, proposed, wouldChange, version }`.
     - **No-op writes:** catalog-api raises the version even on a `PATCH` that changes nothing, which weakens ADR-0004's confirm check. Refuse them, or report `wouldChange: false` without writing?
     - **`get_product` as the only source of `expectedVersion`:** list items do carry `version` (§3.2 is outdated there).
     - **`create_product`'s outcome-unknown hint:** §4.4 wants "the product may have been created; search for the sku before retrying", but `results.ts` gives the generic update hint. Pass a per-tool hint?
     - **Write annotations:**
       - `create_product`: `destructiveHint: false`, `idempotentHint: false`
       - `set_price` / `set_stock`: `idempotentHint: true`? Re-sending the same `expectedVersion` gets a 412, so the write is idempotent in effect.
  4. **Write the plan,** `docs/milestones/<date>-M3-plan.md`, with a Review Focus. Then build test-first, run a fresh reviewer (give it the uncommitted diff and the plan, and tell it **to mutate only a temp copy, with absolute paths**), then `close-milestone`.
- **Carried into M3** (from the M1 and M2 notes):
  - **The tools:** `create_product`, `set_price` and `set_stock`. `expectedVersion` is required, and so is `dryRun`; prices and stock are absolute values only; a 409 is `SKU_EXISTS`; creates are never retried.
  - **`CATALOG_ACCESS=read|write` decides which tools are registered.** With `read`, the write tools don't exist at all (a unit test). The API enforces the key's scope anyway; document both layers.
  - **Skip or report no-op writes** before `updateProduct`.
  - **Never pass `undefined` inside `changes`.**
  - **Error results** are text only, built from the error's fields (ADR-0005).
  - **§4.5's integration tests through the real stdio server:**
    - get, then `set_stock`: version +1
    - a planted concurrent update gives `STALE_VERSION` with the current version
    - `dryRun` writes nothing
    - `CATALOG_ACCESS=write` with the read key gets the API's 403
    - a duplicate SKU gives `SKU_EXISTS`
    - every §4.3 row that can be caused
  - **MCP request timeouts** must allow one conditional update's worst case: about 41 s at the default 5 s timeout. The SDK client's default is 60 s. Inspector waited through 15 s; check it, and Claude Code (whose `MCP_TOOL_TIMEOUT` default is about 28 h), with a slow write.
- **Carried into M4:**
  - CI green on GitHub at the first push; check the `integration` job's run time, which now includes stdio and `.env` tests that build `dist/` and use a `node_modules` junction or symlink
  - gitleaks and the MIT `LICENSE`
  - **the README:**
    - who did what, and the AI's mistakes (from the milestone notes)
    - the §4.6 demo (a Claude Code transcript), and the `.env` step before Claude Code
    - "what I'd change in production": Streamable HTTP with OAuth 2.1 (as walked through on 2026-10-26; read the 2026-07-28 authorization section first), idempotency keys or a SKU lookup for create, and an error schema once the spec has one (SEP-2145)
  - the user creates the GitHub repo after their go-ahead
- **Carried into M6:** log the calls the SDK rejects before our handler (schema errors, unknown tools). Today they get no `tool call` line.
- **Later:** a sweep command for `it-*` products left by a killed integration run.
- **Facts worth remembering:**
  - **catalog-api:**
    - a write takes about 1 s, a read a few ms
    - a `PATCH` commits before its Redis and index calls, so its answer can come up to about 3 s later
    - filters are case-sensitive; `relevance` without `q` is `newest`
    - facets are the top 20 categories and the top 50 brands
  - **The SDK:**
    - it drops in-flight requests when stdin reaches end-of-file
    - `StdioClientTransport` tolerates junk on stdout (only the raw-pipe test catches it)
    - Inspector validates `structuredContent` even on `isError`
  - **Claude Code** starts project servers in the repo folder.
  - **Tests:** keep test client timeouts well clear of 1 s.
- **Outdated in `REQUIREMENTS.md`:**
  - **the MCP spec** is revision 2026-07-28 and the SDK is v2 (ADR-0002)
  - **§3.2:** list items carry `version`
  - **§4.2:** "a short text summary" is now a summary plus the JSON (ADR-0005)
  - **§4.3:** error results are text only, and the SDK's schema rejections are plain text (ADR-0005)
- **Session gotchas:**
  - commit with `git commit -F <file>`
  - edit files with the Edit/Write tools only: no heredocs, no inline Python, no .NET `WriteAllText` (an M2 mutation done that way lost its output)
  - run `npm run typecheck` after every change; check lint by its exit code
  - if `npm run test:int` says "The build failed", fix the tsc errors it printed
- **Open questions / blockers:** none.

## Checklist
### Phase 1: the MCP server (§4)
- [x] M0 Scaffold · 2026-10-26 · 006e630..f548fd0 · [note](milestones/2026-10-26-M0-scaffold.md)
- [x] M1 Catalog client · 2026-10-26 · d1055ae..15bbe9f · [note](milestones/2026-10-26-M1-catalog-client.md)
- [x] M2 MCP server, read tools · 2026-10-26 · d2a2a68..63b32eb · [note](milestones/2026-10-26-M2-mcp-read-tools.md)
- [ ] M3 Write tools
- [ ] M4 Phase 1 release

### Phase 2: the agent loop (§5; starts only after Phase 1 is published and the user says go)
- [ ] M5 Agent loop
- [ ] M6 Robustness
- [ ] M7 Evals
- [ ] M8 Phase 2 release
