# 0005. MCP tool results: text and structured content, errors, pagination, protocol eras

- **Status:** Accepted (approved at the M2 close, 2026-10-26)
- **Date:** 2026-10-26

## Context
- **A tool result** (the answer to a `tools/call`) has a `content` list (text, images, …) and, optionally, `structuredContent`, a JSON value that must match the tool's advertised `outputSchema`. `isError: true` marks a **tool execution error**: an ordinary result that the host passes to the model so it can recover. That's different from a **protocol error** (a JSON-RPC error response), which models usually never see.
- **The MCP spec (revision 2026-07-28, "Tools") says:** "For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block." `REQUIREMENTS.md` §4.2 asks for `structuredContent` "plus a short text summary". Hosts differ in what they forward to the model: some forward only `content`.
- **What the TypeScript SDK v2 (2.4.0) does,** checked in its code and in a spike on 2026-10-26:
  - It validates the arguments against the tool's Zod `inputSchema` before the handler runs. A rejection becomes `isError: true` with **plain text only**: `Input validation error: Invalid arguments for tool search_products: size: Too big: expected number to be <=100`. The method that does this is private, so there's no supported hook to change the shape.
  - A thrown handler error becomes `isError: true` with the error's `message` as the text (no stack).
  - `structuredContent` is validated against `outputSchema` on success and **skipped on `isError` results**, by the SDK's server and by its client.
- **But clients differ on error results** (found in the M2 demo check, 2026-10-26). MCP Inspector 2.12.0 validates `structuredContent` against `outputSchema` even when `isError` is set, and refused to show our first error results ("data must have required property 'id' …"). The spec says "If an output schema is provided: Servers **MUST** provide structured results that conform to this schema", with no exception for errors, and defines no error schema.
- **What well-known servers do** (their source, read on 2026-10-26): none puts a non-conforming error object in `structuredContent`.
  - **Text only:** GitHub's official server (its middleware drops typed output when `IsError` is set, and puts machine-readable error JSON in the text block), the reference servers (filesystem, memory, time), Sentry ("Tool errors MUST be returned as formatted text responses") and Cloudflare.
  - **Loosened schemas:** Supabase puts errors in `structuredContent` by making every success field optional.
  - **The SDKs:** the Go SDK now leaves structured output out of error results (go-sdk PR #1397, merged 2026-10-13).
  - **Inspector's maintainer:** "There is no caveat that clients can skip validation if the result is an error" (typescript-sdk PR #1428, closed).
  - **An error schema is only proposed so far:** a draft SEP-2145 comment and issue #3003.
  - **Two protocol eras:** 2025-era clients open with an `initialize` handshake; 2026-07-28 clients are stateless and send a `_meta` envelope on every request. `serveStdio` serves both from one factory. The wire encodings of a result differ only for a *non-object* `structuredContent` (2025 wraps it as `{result: …}`).
  - `InMemoryTransport.createLinkedPair()` connects 2025-era instances only. A 2026-era client runs in-process through `createMcpHandler(factory).fetch`, with no network.
- **search-service at `v1.1.0`:** exact totals (`track_total_hits`), top 20 categories and top 50 brands in the facets, and `page × size` at most 10,000.

## Considered options
1. **The text block:** (a) **one summary line, then the serialized `structuredContent`**; (b) the summary only (§4.2 as written).
2. **Schema rejections without the §4.3 structure:** (a) **accept the SDK's text and document the exception**; (b) drop `McpServer` for the low-level `Server` and validate inside our own `tools/call` handler, hand-writing the `tools/list` JSON Schemas.
3. **Pagination in `search_products`:** (a) **`total`, `page`, `size`, `hasMore` and `nextPage`, plus the hint in the text**; (b) a `hint` string only.
4. **Which eras the MCP-level tests cover:** (a) **both**, in-process and over stdio; (b) the 2025 era only.
5. **Where an error result carries the §4.3 object** (added after the demo check): (a) **as JSON in the text block, with no `structuredContent`**; (b) in `structuredContent`, with each `outputSchema` loosened to accept it (Supabase's approach); (c) in `structuredContent`, not matching the `outputSchema` (as first built).

## Decision
1(a), 2(a), 3(a), 4(a), 5(a): the user's choices on 2026-10-26, all as recommended. 5 was decided after the research above.

**Successful results.** `content` is one text block: a one-line summary for a reader ("118 products match; showing 1–10. More: call search_products with page: 2."), a blank line, then `JSON.stringify(structuredContent)`. `structuredContent` is always an object, so both eras carry it the same way.

**Error results.** `isError: true` and **no `structuredContent`**. The one text block is a summary line ("Error NOT_FOUND: product not found. Hint: check the id; use search_products to find it."), a blank line, then the §4.3 object as JSON: `{ code, message, retryable, hint, details? }`. A program reads it by parsing the text after the last blank line. The object is built only from a `CatalogError`'s fields (`code`, `message`, `retryable`, `details`), never from the `Error` object or an upstream body. Anything that isn't a `CatalogError` becomes `INTERNAL` with a fixed message; its name goes to the stderr log, never its stack.

**The documented exception to §4.3:** arguments that fail the schema (a bound, an enum, a missing field, an unknown field, `page × size` over 10,000) get the SDK's plain-text `isError` result. It names the field and the bound, which is what a model needs to fix the call. Errors from catalog-api itself (its own 400 `VALIDATION`, 404, …) carry the full structure.

**Pagination.** `hasMore` is `page × size < total`. `nextPage` is present only when that page can be fetched (`(page + 1) × size ≤ 10,000`). When more results exist but the window is used up, the text says to narrow the filters instead.

**Eras.** One MCP-level suite runs against both eras in-process. The stdio tests spawn the built server and connect once per era.

## Consequences
- Any host gives the model the data, at the cost of sending it twice on hosts that forward both blocks. What Claude Code forwards is checked during the M2 demo, and the M7 evals can measure the cost.
- A model sees two error shapes: the SDK's text for a malformed call, ours for everything else. Both are `isError` results it can read. The tool descriptions state the bounds, so malformed calls should be rare.
- Error results work in every client checked (the SDK client and Inspector), and the model sees the same text either way. The cost is that the error shape isn't machine-checked by a schema. If the spec adds an error schema (SEP-2145, issue #3003), a new ADR can adopt it.
- The schemas stay in Zod, one source for validation and for the JSON Schema the model sees, and the contract check compares that JSON Schema with catalog-api's `/docs-json`.
- If a future SDK exposes a hook for validation errors, option 2(b)'s benefit comes back without its cost, and a new ADR would supersede this part.
