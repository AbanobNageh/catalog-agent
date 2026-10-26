# 0004. Catalog client reliability: read retries, conditional writes, confirm after a timeout

- **Status:** Accepted (approved at the M1 close, 2026-10-26)
- **Date:** 2026-10-26

## Context
- Every tool (M2, M3) reaches catalog-api `v1.1.0` through one HTTP client module (`REQUIREMENTS.md` §4.4). The client decides when a failed call is retried, and when a write that may or may not have happened is reported as done.
- **A timeout doesn't say whether a write happened.** The client stops waiting, but the server may still commit. Retrying a write blindly can apply it twice. Not retrying can report a failure for a write that succeeded.
- **What catalog-api `v1.1.0` actually does on a write** (read at the tag, `services/catalog-api/src/products/products.service.ts`):
  1. The `PATCH` commits to Postgres with `WHERE id = $1 AND version = <If-Match>` and `version = version + 1` (product-catalog ADR-0019). Only one write per version can ever match.
  2. It then deletes the Redis copy (`product:<id>`) and calls search-service to reindex the product, waiting **up to 2 s**. A failed index call is only logged, so the `PATCH` still answers 200.
     - Normally that call takes **about 1 s**: search-service writes with `refresh=wait_for`, which waits for OpenSearch's next refresh, once a second. Measured on 2026-10-26: six `PATCH`es took 1003–1006 ms each, against 3 ms for a `GET`.
  3. So a write's response can arrive **after** its commit by up to about 3 s: the Redis delete (bounded at 500 ms), the index call (2 s) and the search-cache bump (500 ms) all run after it. A client that gives up in that window sees a timeout for a write that succeeded. A paused search-service produces exactly this.
  5. `GET /products/:id` is cache-aside in Redis (5 minutes). The `PATCH` deletes the cached copy right after its commit, so a re-read can only see an older version, never a newer one. And a 412 deletes it too (product-catalog ADR-0019), so the re-read after a 412 is fresh.
  4. A `PATCH` answers 503 only if something in front of catalog-api (a proxy or load balancer) does; catalog-api itself returns 503 only from search.
- **Create has no key to check against.** `POST /products` has no idempotency key and there's no lookup by SKU (a known gap, §3.2), so after a timeout the client can't tell whether it created the product.
- **Read requests are safe to repeat,** but only for transient failures; a 4xx will fail the same way again.

## Considered options
1. **Retries:** (a) **reads only, on transient failures** (503, timeout, connection error), at most 2, with exponential backoff and full jitter; (b) also retry writes on transient failures; (c) no retries.
2. **A write that timed out:** (a) **re-read the product and decide from its state** (below); (b) report `UNAVAILABLE` and let the model sort it out; (c) retry blindly.
3. **The retry's own 412** (the spec doesn't cover it): (a) **re-read and apply the same check again**; (b) report `STALE_VERSION`.
4. **How the integration tests make a timeout happen:** (a) **an in-process test proxy** in front of :3100 that can drop a request, cut a response after forwarding it, or answer 503 itself, **plus one end-to-end test that pauses search-service** so the real API commits and answers late; (b) the proxy only; (c) the pause only.
5. **Logger:** (a) **a small JSON logger of our own that writes to stderr**; (b) pino, pointed at fd 2.

## Decision
1(a), 2(a), 3(a), 4(a), 5(a): the user's choices on 2026-10-26, all as recommended.

**Reads (`GET`).** There's a timeout on every request, covering the body too (`CATALOG_TIMEOUT_MS`, default 5000). On 503, a timeout or a connection error, the client retries at most twice. Each wait is a random time between 0 and `min(2000, 200 × 2^attempt)` ms ("full jitter"), so many clients retrying at once spread out instead of arriving together. It never retries a 4xx or any other 5xx.

**Conditional writes** (`set_price`, `set_stock`: `PATCH` with `If-Match: "<expectedVersion>"`):
1. Send the `PATCH`. 200 is success. 412 is `STALE_VERSION` with the current version: on a first attempt, it can't be our own write. Any other 4xx is mapped to its error.
2. On a timeout, a 503 or a connection error, **re-read** the product (a `GET`, with the read retries above). Then:
   - **the target values are there and the version is `expectedVersion + 1`:** the write happened. Return success, marked `confirmedAfterTimeout: true`
   - **the version is still `expectedVersion`:** it didn't happen yet. **Retry the `PATCH` once**, with the same `If-Match`
   - **anything else** (another version, other values): someone else wrote in between. Return `STALE_VERSION` with the current version
   - **the product is gone:** `NOT_FOUND`. **The re-read itself fails, in any other way (a 500 too):** `UNAVAILABLE`, saying the outcome is unknown
3. If the one retry gets a 412, or times out again, re-read once more and apply the same check. A 412 here can be our *first* attempt landing late, after the re-read. Without a re-read the client would report a conflict that was really its own write. If the product is still at `expectedVersion` after the retry, give up with `UNAVAILABLE`, outcome unknown: either attempt may still be in flight.
4. **Once the first attempt is ambiguous, no later error is reported as a plain failure** (found by the M1 review): any error but `NOT_FOUND` or `STALE_VERSION` becomes `UNAVAILABLE` with the outcome unknown, because the first attempt may still land.
- **Why this can't apply a write twice:** both attempts carry the same `If-Match`, and catalog-api puts it in the `UPDATE`'s `WHERE` clause. Whichever lands first raises the version, so the other matches no row and gets a 412. At most one of them commits.
- **What "the target values are there" can't tell:**
  - That another client wrote the same value in the same version step. The end state is then what was asked for, so success is the right report.
  - That our change was a **no-op** (the value was already there). catalog-api still raises the version on a no-op `PATCH` (checked live), so after a timeout, someone else's change to another field in that version step looks like ours. The M3 tools avoid sending no-op writes (`dryRun`'s `wouldChange`). An empty change is refused by the client before anything is sent.

**Create** is never retried. After a timeout, a 503 or a connection error it returns `UNAVAILABLE` with the outcome marked unknown. The M3 tool adds the hint "the product may have been created; search for the sku before retrying".

**Errors** are typed in the client: `CatalogError { code, status?, message, retryable, details?, retries }`, with the codes from §4.3. `message` is catalog-api's `message` field (a validation list is joined), cut to 500 characters. A 409 on create or update is `SKU_EXISTS` (an update that changes the sku can hit one). A 2xx body that isn't JSON is `INTERNAL` (with the outcome unknown after a write). The client never returns the full upstream body, a stack trace, or the key. The hints in §4.3 name tools (`get_product`, `search_products`), so they belong to the tool layer (M3), which builds tool results from `{ code, message, retryable, details }` only, never from the `Error` object.

**Logs:** one JSON line per HTTP request on stderr, through our own logger: level, time, message, op, method, path (without the query), `retry` (0 for a first try), status or error code and cause, duration, plus the tool name and a correlation id passed in by the caller (generated if missing). A conditional update adds one summary line (attempts, `confirmedAfterTimeout`, the version). Fields named like credentials (`authorization`, `apiKey`, `token`, `secret`, `password`, …; whole names only, so `prompt_tokens` stays visible) are redacted by the logger as a second line of defence; the client never passes the key to it.

**Tests:**
- **Unit:** an injected `fetch` and an injected clock (`now`, `sleep`) plus a random source, so backoff and timeouts run deterministically without real waiting. Every branch above is unit-tested.
- **Integration**, against the Compose stack, through the fault proxy:
  - landed, then the response was lost
  - never arrived, then the retry
  - a 503 on the `PATCH`
  - a concurrent write before and after our own
  - read retries
  - create's unknown outcome
- **Integration, unit-tested only:** the retry's own 412, a failed re-read, a deleted product, and the retry timing out. Driving them end to end would need the proxy to hold one request and reorder it after a later one.
- **The real pause:** search-service paused, with a client timeout of 1.5 s, between a normal write (about 1 s) and a paused one (about 2 s), and a control write first.

## Consequences
- Good: the agent never sees a false failure for a write that happened, and never causes a double write. This is the reliability point Phase 1 shows (§4.4).
- Good: the backoff is jittered and bounded. With 2 retries, the waits are at most 200 ms and 400 ms, so the worst case for a read is 3 × 5 s plus 0.6 s.
- **The worst case for one conditional update** at the default timeout is about 41 s: two `PATCH`es of 5 s each, and two re-reads of up to 15.6 s each. Anything that waits on a tool call (the MCP request timeout, M5's per-call timeout) must allow for that.
- The default 5 s timeout leaves about 4 s of headroom over a normal write (about 1 s) and 2 s over catalog-api's slowest normal answer after a commit (about 3 s), so in normal operation the confirm path only runs on a real outage. Test timeouts must stay clear of 1 s: just below it, every write "times out", and a test can pass for the wrong reason.
- Bad: the confirm path costs up to two extra reads and one extra write in the worst case, and the logic needs care. It's the most heavily tested part of the client.
- Bad: create stays at-most-once from the client's side, with an unknown outcome after a timeout, until catalog-api gets idempotency keys or a lookup by SKU. That's a production follow-up for the README, not something to solve here.
- Bad: the fault proxy is test-only code that has to stay simple enough to trust; it gets its own tests.
- The pause test briefly stops search-service on the shared stack, so integration tests run one file at a time, and the pause is always undone in a `finally`.

## Revisit when
catalog-api adds an idempotency key or a lookup by SKU, or the MCP server gets more than one caller per product at a time (Streamable HTTP).
