# M2 MCP server, read tools
- Date: 2026-10-26 · Commits: d2a2a68, c2f0a4c, 63b32eb · Plan: [2026-10-26-M2-plan.md](2026-10-26-M2-plan.md) · Design: [ADR-0005](../adr/0005-mcp-tool-results-and-errors.md)

## What was built
- **`src/main.ts`, the stdio entry point (`node dist/main.js`):**
  - loads the repo root's `.env` by its own location, so the working directory doesn't matter; variables already set win
  - an unreadable `.env` or a bad config is one JSON error line and exit 1
  - `serveStdio` serves both protocol eras: 2025 (an `initialize` handshake) and 2026-07-28 (stateless, a `_meta` envelope per request)
- **`src/mcp/`:**
  - `server.ts`: `createServer`, with the three tools in a fixed order
  - `schemas.ts`: Zod inputs with catalog-api's bounds (int32, `size` 1–100, default 10, `q` ≤ 200, the `sort` enum), strict objects, and the `page × size ≤ 10,000` and `maxPrice ≥ minPrice` refines; the output schemas
  - `results.ts`: success is `structuredContent` plus a text block of a summary and the same JSON; an error is `isError` with text only, ending in the §4.3 `{code, message, retryable, hint, details?}` JSON; every §4.3 hint, including "the change may have been applied"
  - `tool-call.ts`: per call, a correlation id and stats, any thrown value turned into an error result, and one `tool call` log line
  - `money.ts`: "799.00 EGP", with integer arithmetic
  - the tools:
    - `search_products`: compact hits, with `total`, `page`, `size`, `hasMore`, `nextPage?`, and `facets` only on request
    - `get_product`: the full product with `version` and `price`
    - `list_facets`: counts only
  - annotations `readOnlyHint: true`, `openWorldHint: false`
- **`src/catalog/`:**
  - per-call request and retry stats
  - the client's key is replaced in any upstream message, before the message is cut to 500 characters
- **`.mcp.json`:** registers the server as `catalog` in Claude Code.
- **Tests:**
  - **Unit, `npm test`:** 210 tests. The MCP-level suite runs every test in both eras, in-process: `InMemoryTransport` for 2025, `createMcpHandler().fetch` for 2026.
  - **Integration, `npm run test:int`:** 42 tests, about 65 s; its global setup builds `dist/` first.
    - a raw-pipe stdio test: every stdout line is JSON-RPC
    - SDK-client stdio tests in both eras
    - the tools against catalog-api v1.1.0
    - the `.env` location, from another working directory
    - the contract check against the live `/docs-json`
- **Verified, 2026-10-26:**
  - unit, integration, lint, typecheck, format and build all pass
  - mutations, each caught:
    - a stray stdout write
    - contract drift: `size`, `q`, `sort`, and an output type
    - `nextPage` past the window
    - a leaked error message
    - the `.env` path
  - MCP Inspector 2.12.0, CLI, through `.mcp.json`:
    - `tools/list --strict` is clean
    - calls work, and the key comes from `.env`
    - it waits through a read's 15.3 s worst case
  - Claude Code: the user's session. Search, details and `NOT_FOUND` all worked; the model read the paging and the price correctly, and got the text-only error.

## Decisions
- **[ADR-0005](../adr/0005-mcp-tool-results-and-errors.md), accepted at this close.**
- **The user's choices (2026-10-26):** all as recommended.
  - the text block is a summary plus the JSON (the spec's SHOULD, rather than §4.2's "short summary")
  - MCP-level tests in both eras
  - the SDK's schema-rejection text accepted as an exception to §4.3
  - `hasMore` and `nextPage`
  - error results as JSON in text, with no `structuredContent`. This one was decided after the demo check and a research round the user asked for.
- **The AI's rulings:** the plan's ledger, 13 entries. Among them:
  - `.env` is loaded in code, not with `--env-file`
  - strict inputs and int32 bounds
  - `size` defaults to 10
  - the full §4.3 error mapping is built now
  - the stdio tests live in the `int` project, which builds first
  - TypeScript 7's hidden `bin/tsc`
- **Facts found:**
  - the SDK drops in-flight requests when stdin reaches end-of-file
  - the SDK's `StdioClientTransport` tolerates junk lines on stdout
  - the SDK client's default request timeout is 60 s
  - catalog-api's filters are case-sensitive, and `relevance` without `q` is `newest`
  - facets are the top 20 categories and the top 50 brands; totals are exact
  - Claude Code starts project servers in the repo folder

## Review findings and corrections
- **The user's demo check found the milestone's main design flaw.** MCP Inspector rejected error results that carried a non-matching `structuredContent`. The spec says structured results MUST match the `outputSchema`, and Inspector's maintainer holds that errors aren't exempt. The SDK's own client and server skip the check, which is why the tests passed.
  - **The user asked how well-known servers handle this.** A research agent read their source: GitHub's official server, the reference servers, Sentry, Cloudflare and Supabase. The AI checked the two key citations itself.
  - **The result:** none of them puts a non-matching error object in `structuredContent`. Most return text, some with JSON inside it, and the Go SDK now strips structured output from errors.
  - The user chose JSON in the text, and it was changed test-first.
- **The fresh reviewer** (a separate agent; it ran every suite, probed the live API and raw stdio, and ran mutations) reported 0 Critical, 2 Important and 7 Minor findings. Each is re-graded in the plan.
  1. **I1, fixed:** a JSON `message` from upstream that echoed the key would have reached tool results. The planned "no key in any result" sweep only used HTML bodies, so it didn't prove its claim. While fixing it, the AI found a hole in its own fix: the message was cut before the key was replaced, which could leave a prefix.
  2. **I2, fixed:** the `.env` location was untested. A path mutation passed every test. A new spawned test with its own layout catches it.
  3. **Minor:**
     - **fixed:** an unreadable `.env` printed a raw stack trace; facet buckets passed upstream fields through; three descriptions were wrong (`relevance` without `q`, case sensitivity, the facet caps); gaps in the contract check; docs drift
     - **deferred to M6:** calls the SDK rejects get no log line, because there's no clean hook
- **The reviewer's own slip:** one of its mutations was written into the working tree instead of its copy. The AI noticed, the reviewer restored it, and the AI checked that nothing else had changed.
- **The AI's own mistakes:**
  - It wrote `main.ts` before its test, so its stdio test was proven by mutation instead.
  - Its Claude Code instructions claimed a default key that doesn't exist. The server exited at start, and Claude Code showed only `CONNECTION_CLOSED`.
  - It first built structured errors on the SDK's behaviour, without checking a second client.
  - A test title's placeholders were out of step with its values.
  - It wrote one mutation with .NET instead of the Edit tool, against `AGENTS.md`.
  - When a build failed inside the test setup, the AI first saw only Vitest's misleading crash. The setup now says what failed.

## Follow-ups
- **M3:**
  - the write tools
  - `CATALOG_ACCESS=read|write` decides which tools are registered
  - skip or report no-op writes (`dryRun`'s `wouldChange`)
  - no `undefined` inside `changes`
  - the write rows of §4.3 tested through the write tools. The hints are built: `SKU_EXISTS`, `STALE_VERSION`, "the change may have been applied", and §4.4's create-specific hint, which needs a small addition
  - write-tool annotations: `destructiveHint`, `idempotentHint`
  - decide whether `get_product` stays the only source of `expectedVersion`
- **M6:** count and log the calls the SDK rejects before our handler.
- **M4 (README):**
  - who did what, and the AI's mistakes from these notes
  - "what I'd change in production": Streamable HTTP with OAuth 2.1; an error schema once the spec has one (SEP-2145)
  - the `.env` step before Claude Code
- **Unknown:** whether Claude Code gives the model the text block, `structuredContent` or both on a success.
