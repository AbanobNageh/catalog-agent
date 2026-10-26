# Status

> Edit rules: the AI rewrites **Now** whenever the next step changes. The **Checklist** is tick-only: change `[ ]` to `[x]` and append `· date · commit · note link`. Never reword, reorder or delete items without asking.

## Now
- **Current:** M2 MCP server, read tools (§4.1, §4.2's read tools, §4.5 MCP-level tests, §4.6, the M2 row of §7). Not started; no plan yet.
- **Last session:** 2026-10-26. Closed M0 ([note](milestones/2026-10-26-M0-scaffold.md)) and M1 ([note](milestones/2026-10-26-M1-catalog-client.md)). M1 built `CatalogClient` (`src/catalog/`), the only path to catalog-api: timeouts, read retries with full-jitter backoff, and conditional writes confirmed after a timeout (ADR-0004, accepted). Plus the stderr JSON logger, a test-only fault proxy, 116 unit and 20 integration tests, and a CI integration job. **Running:** the `catalog-agent` Compose stack on :3100, seeded (10,000 products). The user asked to compact after the M1 close.
- **Next step: start M2,** following the milestone flow in `AGENTS.md`:
  1. **Check the official docs first.** Most MCP tutorials are for SDK v1, and we use v2 (ADR-0002). Start at https://ts.sdk.modelcontextprotocol.io/v2/:
     - `registerTool` with Zod 4 `inputSchema`/`outputSchema`, `structuredContent` and tool annotations (`readOnlyHint` and so on)
     - `serveStdio(() => createServer())` (it serves 2025-era and 2026-07-28 clients)
     - `InMemoryTransport` for MCP-level tests (one package per linked pair)
     - how the 2026-07-28 revision encodes structured results
     - the SDK's request timeout
     - check `npm view` for newer 2.x versions
  2. **Install the pins from ADR-0002:** `@modelcontextprotocol/server@2.4.0`, `@modelcontextprotocol/client@2.4.0` (tests), `zod@4.6.7`, unless step 1 finds a reason to move (then a superseding ADR).
  3. **Likely decisions to ask the user:**
     - how the entry point loads `.env` (`node --env-file-if-exists=.env` in `.mcp.json` / npm scripts, or `process.loadEnvFile`)
     - the contract check's design: a test reading `/docs-json` from the running catalog-api and comparing the tools' bounds and enums, such as `sort` and `size` ≤ 100
     - whether the MCP-level tests cover both protocol eras
     - the shape of `search_products`'s compact hits and its "more pages" hint
  4. **Write the plan,** `docs/milestones/2026-10-26-M2-plan.md` (or the day's date), with a Review Focus. Build test-first, then a fresh reviewer, then `close-milestone`.
- **Carried into M2:**
  - `.mcp.json` registers the server over stdio; it needs `npm run build` first (say so in `AGENTS.md`, later the README)
  - the first entry point loads `.env`
  - a stdio test that stdout carries only JSON-RPC: `no-console` misses `process.stdout.write` and aliased consoles
  - return a successful read's retry count, so the per-tool-call log has it (§4.4)
  - MCP request timeouts must allow one conditional update's worst case (about 41 s at the default 5 s timeout; ADR-0004)
  - check §4's tool features against the v2 docs
  - works in MCP Inspector (2.12.0 uses SDK v2) and in Claude Code
- **Carried into M3:**
  - skip or report no-op writes before `updateProduct` (`dryRun`'s `wouldChange`): catalog-api raises the version on a no-op `PATCH`, which weakens the confirm check
  - never pass `undefined` inside `changes`
  - build tool results from the error's fields (`code`, `message`, `retryable`, `details`), never the `Error` object
  - the §4.3 hints, including "the change may have been applied; read the product before retrying" for `details.outcome: 'unknown'`
  - `CATALOG_ACCESS=read|write` decides which tools are registered
- **Carried into M4:**
  - CI green on GitHub at the first push; check the `integration` job's run time and decide whether it stays on every pull request (§6)
  - install gitleaks; the MIT `LICENSE`. The user creates the GitHub repo after their go-ahead
  - README "what I'd change in production": a remote MCP server over Streamable HTTP with OAuth 2.1 (resource server, audience checks, token exchange, no token passthrough), as walked through with the user on 2026-10-26; read the 2026-07-28 spec's authorization section first
  - idempotency keys or SKU lookup for create
- **Later:** a sweep command for `it-*` products left by a killed integration run.
- **Facts worth remembering** (in ADR-0004 and `AGENTS.md`):
  - a catalog-api write takes about 1 s (search-service's `refresh=wait_for`), a read a few ms
  - a `PATCH` commits before its Redis and index calls (its answer can come up to about 3 s later)
  - a paused search-service makes a real "committed, answered late" write
  - keep test client timeouts well clear of 1 s
- **Outdated in `REQUIREMENTS.md` (found 2026-10-26):**
  - The MCP spec is now revision 2026-07-28 (stateless), and the official TypeScript SDK is v2, split into `@modelcontextprotocol/server` and `/client` (ADR-0002). §4 and §5 still read correctly at the level of tools, `structuredContent` and annotations; check each against the v2 docs in M2 and M3.
  - §3.2: list items from `GET /products` **do** carry `version` (checked live; the list ETag is weak, as the spec says). Decide in M2/M3 whether `get_product` stays the only source of `expectedVersion`.
- **Session gotchas:** commit with `git commit -F <file>`; edit files with the Edit/Write tools only, never heredocs or inline Python replacements (an M1 replacement silently missed a Prettier-formatted file); run `npm run typecheck` after every change (Vitest doesn't typecheck); check lint by its exit code.
- **Open questions / blockers:** none.

## Checklist
### Phase 1: the MCP server (§4)
- [x] M0 Scaffold · 2026-10-26 · 006e630..f548fd0 · [note](milestones/2026-10-26-M0-scaffold.md)
- [x] M1 Catalog client · 2026-10-26 · d1055ae..15bbe9f · [note](milestones/2026-10-26-M1-catalog-client.md)
- [ ] M2 MCP server, read tools
- [ ] M3 Write tools
- [ ] M4 Phase 1 release

### Phase 2: the agent loop (§5; starts only after Phase 1 is published and the user says go)
- [ ] M5 Agent loop
- [ ] M6 Robustness
- [ ] M7 Evals
- [ ] M8 Phase 2 release
