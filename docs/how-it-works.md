# How it works

The technical detail behind the [README](../README.md): the tools, the error model, the reliability rules, the tests, and what I'd change in production. The decisions themselves, with the options considered, are in the [ADRs](adr/).

## MCP in one paragraph
An MCP *host* (Claude Code) starts the server as a child process and talks to it over *stdio*. stdout is the protocol, so every log line goes to stderr. The server offers *tools*: each has a name, a description the model reads, an input schema and an output schema. A tool *result* carries `structuredContent` (JSON matching the output schema) and a text block. An error is a normal result with `isError: true`, so the model sees it and can recover. *Annotations* (`readOnlyHint`, `destructiveHint`, …) are hints to the host about what a tool does; they enforce nothing.

- **The server is an ordinary HTTP client** of catalog-api, configured with one API key. It never changes product-catalog, whose stack this repo builds from the `v1.1.0` git tag ([ADR-0003](adr/0003-catalog-stack-from-git-tag.md)).
- **One client module** (`src/catalog/client.ts`) is the only path to the API. Tools never call `fetch` themselves.
- **Both MCP protocol eras are served:** 2025-era clients that open with an `initialize` handshake, and stateless 2026-07-28 clients ([ADR-0005](adr/0005-mcp-tool-results-and-errors.md)).

## The tools

| Tool | Registered when | Calls | Annotations |
|---|---|---|---|
| `search_products` | always | `GET /products/search` | read-only |
| `get_product` | always | `GET /products/:id` | read-only |
| `list_facets` | always | search with facets | read-only |
| `create_product` | `CATALOG_ACCESS=write` | `POST /products` | additive, not idempotent |
| `set_price` | `CATALOG_ACCESS=write` | `GET`, then `PATCH {priceCents}` with `If-Match` | destructive, idempotent |
| `set_stock` | `CATALOG_ACCESS=write` | `GET`, then `PATCH {stock}` with `If-Match` | destructive, idempotent |

- **Inputs have the API's own bounds** (integers up to int32, `size` 1–100, the `sort` values, `page × size` ≤ 10,000), so a bad call is rejected before it's sent. A contract test compares them with catalog-api's live `/docs-json`.
- **Outputs are small:** search returns compact hits (no description), the total, and paging (`hasMore`, `nextPage`). Money is in cents, with a formatted string next to it ("889.00 EGP").
- **`set_price` and `set_stock`** take an absolute value, the `expectedVersion` the model read, and a required `dryRun`. A dry run returns `{ current, proposed, wouldChange, version }` and writes nothing. A value that's already there is a success with nothing sent. Every result carries the version to send next ([ADR-0006](adr/0006-write-tools.md)).

### Least privilege, in two layers
1. **This server:** with `CATALOG_ACCESS=read`, the write tools are never registered, so they don't exist for the client. Hiding them isn't enough.
2. **catalog-api:** the key's scope (`read` < `write` < `admin`) decides which calls succeed. A write with the read key gets the API's 403, as `FORBIDDEN`.

Unset, `CATALOG_ACCESS` means `write`, like most well-known servers (my choice; the AI had recommended `read`). `.env.example` sets `read` next to the read key.

**Never exposed: delete and reindex.** No restock or pricing task needs them, and an agent can misread a request or follow an instruction injected into data it reads. Keeping destructive admin operations out of the tool list, and the admin key out of the server's configuration, means no prompt can reach them.

## The error model
Every error is a tool result with `isError: true`, so the model sees it. Its text is a summary line, then a JSON object `{ code, message, retryable, hint, details? }`:

| Cause | `code` | `retryable` | `hint` |
|---|---|---|---|
| 400 | `VALIDATION` | no | the API's own messages, naming the fields |
| 401 | `UNAUTHORIZED` | no | "the MCP server's catalog key is missing or wrong (configuration problem)" |
| 403 | `FORBIDDEN` | no | the API's message, naming the scope that's needed |
| 404 | `NOT_FOUND` | no | "check the id; use search_products to find it" |
| 409 | `SKU_EXISTS` | no | "a product with this sku already exists" |
| 412 | `STALE_VERSION` | yes, after a re-read | "the product changed (current version 11); call get_product, check the change still makes sense, then retry with expectedVersion 11" |
| 503, timeout, connection error | `UNAVAILABLE` | yes | "temporary; retry later", or after a write whose outcome is unknown, "the change may have been applied; read the product before retrying" (create has its own wording, below) |
| anything else | `INTERNAL` | no | "an unexpected error; retrying the same call will not help" |

- **Errors carry no `structuredContent`.** The spec says structured results must match the output schema and defines no error schema, and MCP Inspector rejects anything else. How well-known servers handle it, and why the JSON goes in the text: [ADR-0005](adr/0005-mcp-tool-results-and-errors.md).
- **One exception:** arguments that fail the input schema get the SDK's own plain-text error, which names the field and the bound.
- **Never in a result or a log:** the API key, a stack trace, or a full upstream body. Tests check all three, including keys echoed back inside upstream messages.

## Reliability
The rules and their reasoning: [ADR-0004](adr/0004-catalog-client-reliability.md).

- **A timeout on every request** (5 s by default), covering the body too.
- **Reads are retried** at most twice, on a 503, a timeout or a connection error, with exponential backoff and full jitter. Never on a 4xx. Worst case for a read: about 15.6 s.
- **Writes are never blindly retried.** A set call sends `If-Match: "<expectedVersion>"`, which catalog-api puts in the `UPDATE`'s `WHERE` clause. After a timeout, a 503 or a connection error, the client re-reads the product:
  - the new value is there at `expectedVersion + 1`: success, marked `confirmedAfterTimeout: true`
  - still at `expectedVersion`: retry once, with the same `If-Match`
  - anything else: `STALE_VERSION`
  - both attempts carry the same version, so at most one of them can commit
- **Once a write's outcome is ambiguous, no later error is reported as a plain failure:** apart from `NOT_FOUND` and `STALE_VERSION`, it's `UNAVAILABLE` with "the change may have been applied".
- **`create_product` is never retried.** catalog-api has no lookup by SKU and no idempotency key, so after a timeout the outcome is unknown. The hint tells the model how to check (search by name and category, newest first) and that a retry with the *same* SKU can't duplicate the product.
- **Cancellation:** when the client cancels a call, no further `PATCH` is sent.
- **The worst case for one set call** is about 11 × `CATALOG_TIMEOUT_MS` plus 2 s: about 57 s at the default, just under the MCP SDK client's 60 s default request timeout (which Inspector's CLI uses). Only during an outage.
- **Logs:** one JSON line per HTTP request and per tool call on stderr, with a correlation id, the retry count, status and duration. Never the key.

## Tests
- **Unit and MCP-level, `npm test`:** 327 tests, no stack. The MCP-level suites connect an SDK client to the server in-process in **both protocol eras**, against a fake catalog-api that records every method, body and `If-Match`. The retry and backoff rules run on an injected clock.
- **Integration, `npm run test:int`:** 61 tests in 8 files against the Compose stack:
  - **through the real stdio server** (`dist/main.js`, spawned; about 30 tests): the tools in both eras, every §4.3 error that can be caused (including a real 412 and the read key's 403), confirm-after-timeout through a test-only fault proxy, a raw-pipe test that every stdout line is JSON-RPC, and the `.env` location from another working directory
  - **the catalog client directly:** every confirm-after-timeout branch through the fault proxy, and a real late answer (search-service paused, so the API commits but answers late)
  - **the contract check,** in-process: every tool's bounds, enums and fields against the live `/docs-json`
  - each file creates its own products in an `it-<runid>-*` category and deletes them; nothing touches the seed
- **Mutation checks:** at each milestone, the AI broke a rule on purpose (a dry run that writes, a skipped version check, a stray stdout write, contract drift, …) and showed a test fail. Each [milestone note](milestones/) lists them.
- **CI** ([ci.yml](../.github/workflows/ci.yml)): lint, typecheck, format, unit tests and build, then the integration job on the Compose stack built from `v1.1.0` and seeded. No secrets.

## What Claude Code does with this server
Seen in the [demo session](demo/transcript.md) (Claude Code v2.1.310, manual permission mode) and its log:
- **It asks before every tool call, read-only tools included.** `readOnlyHint` doesn't skip its prompt; its docs say it uses the hint to run read-only calls in parallel.
- **It prompts for a dry run like a real write,** since it can't know what `dryRun: true` means. Our dry run protects the data; the host's prompt protects the call. A "don't ask again" on `set_stock` would cover real writes too.
- **It passes the model the `structuredContent` JSON of a success,** not our text summary, and the text of an error.
- **`idempotentHint`** lets it re-send a pending call after a dropped connection, but only for HTTP servers and claude.ai connectors (its docs), so it never applies to this stdio server.

## What I'd change in production
- **A remote server over Streamable HTTP, with OAuth 2.1.** A stdio server takes its credentials from the environment, as this one does. A remote one is an OAuth resource server under the MCP spec's authorization rules (revision 2026-07-28): it publishes Protected Resource Metadata (RFC 9728), accepts only tokens issued for itself (audience check, RFC 8707), and must not pass the client's token on to catalog-api. It would get its own credential per user instead, for example by token exchange. The tool list could then follow each caller's scopes.
- **Create with a lookup by SKU or an idempotency key in catalog-api,** so a create that timed out can be checked or safely retried. That's a new product-catalog release.
- **catalog-api's read cache:** its Redis copy of a product can lag a write when a cache delete fails (the error is swallowed), and a set call's first read trusts it. `If-Match` still stops a stale write, but a false "nothing to change" is possible ([ADR-0006](adr/0006-write-tools.md)). A read that bypasses the cache before a write would close it.
- **A deadline for a whole set call,** instead of a worst case that grows with the per-request timeout (about 57 s at the default).
- **An error schema** once the spec has one (SEP-2145 is in review), instead of JSON in the text block.
- **Observability and limits:** OpenTelemetry traces per tool call (the correlation id is already in every log line), metrics, per-caller rate limits, and a log line for calls the SDK rejects before our handler (today they get none).

## Repository map

| Path | What |
|---|---|
| `src/main.ts` | The stdio entry point: loads `.env`, checks the config, serves both protocol eras |
| `src/mcp/` | The server, the tools, input and output schemas, results and errors |
| `src/catalog/` | The catalog-api client: timeouts, retries, conditional writes, typed errors |
| `src/testing/` | Test-only helpers: the fault proxy, fixtures, the in-process MCP harness |
| `docker-compose.yml` | catalog-api `v1.1.0`, search-service, PostgreSQL, Redis and OpenSearch, built from product-catalog's git tag |
| `.mcp.json` | Registers the server in Claude Code |
| `docs/` | Status, milestone plans and notes, ADRs, the demo, the AI workflow |
| `REQUIREMENTS.md` | The spec I wrote for the AI |
| `AGENTS.md`, `CLAUDE.md`, `.claude/` | The AI assistant's instructions, settings and skill |
