# M1 Catalog client
- Date: 2026-10-26 · Commits: d1055ae, 02af04d, bb57875, 15bbe9f · Plan: [2026-10-26-M1-plan.md](2026-10-26-M1-plan.md) · Design: [ADR-0004](../adr/0004-catalog-client-reliability.md)

## What was built
- **`src/log.ts`:** one JSON line per event on stderr, never stdout. Fields named like credentials (whole names) are redacted.
- **`src/config.ts`:** `CATALOG_TIMEOUT_MS` (default 5000, from 100 to 60000), next to M0's URL and key.
- **`src/catalog/errors.ts`:** `CatalogError { code, status?, message, retryable, details?, retries }`, with the §4.3 codes.
  - 409 on create or update is `SKU_EXISTS`; 412 is `STALE_VERSION` with `currentVersion`.
  - A network error is `UNAVAILABLE` with `cause` (`timeout`, `ECONNREFUSED`, …).
  - Messages come from catalog-api's `message` field, cut to 500 characters: never the raw body, fetch's own message, or the key.
- **`src/catalog/retry.ts`:** full-jitter backoff (`random × min(2000, 200 × 2^n)`), and `withReadRetries`: at most 2 retries, on `UNAVAILABLE` only. The clock and random source are injected.
- **`src/catalog/client.ts`, `CatalogClient`,** the only path to catalog-api:
  - `search`, `getProduct`: read retries
  - `createProduct`: never retried; after a timeout, the outcome is unknown
  - `updateProduct(id, changes, expectedVersion)`: the conditional `PATCH` with ADR-0004's confirm-after-timeout logic, returning `{ product, confirmedAfterTimeout, attempts }`
  - every request has a timeout that covers the body, and gets one log line with tool, correlation id, op, method, path, `retry`, status or code, and duration
- **`src/testing/`** (not built into `dist/`): `fault-proxy.ts` (`hang`, `cutAfterForward`, `{status}`) and `fixtures.ts` (products in `it-<runid>-<suite>`, cleaned up with the admin key).
- **Tests:**
  - Unit, `npm test`: 116 tests, no stack needed.
  - Integration, `npm run test:int` (Vitest project `int`, one file at a time, about 55 s): 20 tests against catalog-api `v1.1.0`.
    - `client.int.test.ts`: every §4.3 code that can be caused
    - `confirm.int.test.ts`: the confirm branches through the proxy
    - `pause.int.test.ts`: a real late answer, with search-service paused and a control write
- **CI:** a new `integration` job (Compose built from `v1.1.0`, then `test:int`); lint now fails on warnings.
- **Verified, 2026-10-26:**
  - unit, lint, typecheck, format and build pass, also on a clean copy of the tree
  - the integration suite was green on five full runs (three of them in a row before the review)
  - after each run, exactly 10,000 products and no `it-` or `review-` leftovers
  - mutation checks: `>=` instead of `===` for the version; the retry's 412 not re-read; a different `If-Match` on the retry; `.some` instead of `.every`; the pause test at 900 ms. Each was caught by a test.
  - The CI `integration` job hasn't run yet (no GitHub repo until M4).

## Decisions
- [ADR-0004](../adr/0004-catalog-client-reliability.md), accepted at this close.
- **The user's choices (2026-10-26):** a fault proxy plus one real search-service pause; after the retry's 412, re-read and confirm again; our own small logger. All three as recommended.
- **Facts found while designing,** from reading catalog-api `v1.1.0` and measuring it:
  - a `PATCH` commits before its Redis and index calls, so its answer can come up to about 3 s after the commit
  - a normal write takes about 1 s (search-service's `refresh=wait_for`), a read a few ms
  - a no-op `PATCH` still raises the version
- **The AI's rulings** (the plan's ledger):
  - lint fails on warnings
  - `SearchParams` accepts an explicit `undefined`
  - one log line per request, with `retry`, plus a summary line per conditional update
  - after both attempts fail, the outcome is "unknown", not "not applied"
  - fixtures use plain `fetch` and the paged list
  - test timeouts: 3 s through the proxy, 1.5 s with a control write for the pause
  - the retry's own 412 is unit-tested only
  - `CatalogError.retries`

## Review findings and corrections
- **The fresh reviewer** (a separate AI agent, read-only; it ran every suite, probed the live API on its own `review-` products, and ran mutations on a copy) found no double-write path, no loop and no blind retry. It reported 1 Important and 13 Minor issues. Each is re-graded in the plan's "Fresh review" section.
  1. **Important, fixed test-first:** after an ambiguous first `PATCH`, a 500 on the re-read or the retry was reported as a plain failure, although the first attempt could still land. M3 would have told the model "failed" for a write that may apply. Every later error except `NOT_FOUND` and `STALE_VERSION` now reports the outcome as unknown.
  2. **The plan claimed a test that didn't exist** ("no key in error messages"). The reviewer showed it by adding the key to every network error message: all 106 tests still passed. The test exists now.
  3. **ADR-0004 had wrong numbers:** the backoff waits total at most 0.6 s, not about 3 s; a late answer comes up to about 3 s after the commit, not 2 s. Its claim that the proxy drives every branch was also wrong. All corrected; the Redis cache and the ~41 s worst case are now described.
  4. Smaller fixes:
     - a non-JSON success body leaked as a `SyntaxError` quoting it
     - 409 on update
     - an empty change
     - the retry count lost by `outcomeUnknown`
     - a silently ignored Vitest option
     - docs drift
     - an unhandled rejection in the proxy
     - the logger would have redacted Phase 2's `prompt_tokens`
- **The AI's own mistakes, caught before the review:**
  - **Its first pause test could pass for the wrong reason.** A 1000 ms client timeout is below a normal write's ~1005 ms, so the write would "time out" with or without the pause. It showed up as a flaky proxy test. The AI's first explanation (test-file order) was wrong; the logs showed the 1 s index writes. Fixed with a 1.5 s timeout and a control write, which a 900 ms mutation now proves.
  - `npm test` passed twice while `tsc` failed, because Vitest strips types without checking them.
  - The first logs lacked the retry count §4.4 asks for.
- **The AI's mistake while fixing the review:** it used a shell heredoc and a Python replacement, against `AGENTS.md`. The replacement silently didn't match a Prettier-formatted file, and the edits were redone with the Edit tool.
- **The user** reviewed the tour and asked how a model actually uses this client. The answer: it can't yet; the MCP server (M2) is the missing layer. The user then asked how a deployed API and real per-user auth would work (local vs remote MCP servers; OAuth 2.1, token validation and token exchange, step by step). No code changes; the auth story is a README follow-up.

## Follow-ups
- **M2:**
  - return a successful read's retry count, for the per-tool-call log
  - MCP request timeouts must allow one conditional update's worst case (about 41 s at the default timeout)
  - the first entry point loads `.env`
  - the stdio test that stdout carries only JSON-RPC
- **M3:**
  - skip or report no-op writes before calling `updateProduct` (`dryRun`'s `wouldChange`)
  - never pass `undefined` inside `changes`
  - build tool results from the error's fields, never the `Error` object
  - the §4.3 hints, including "the change may have been applied" for `outcome: 'unknown'`
- **M4 (README):**
  - "what I'd change in production": a remote MCP server over Streamable HTTP with OAuth 2.1 (the server as resource server, audience checks, token exchange instead of token passthrough), as explained to the user on 2026-10-26; check the 2026-07-28 spec's authorization section first
  - idempotency keys or SKU lookup for create
- **Later:** a sweep command for `it-*` products left by a killed integration run.
- **At M4:** check the CI `integration` job's run time on GitHub, and decide whether it stays on every pull request (§6).
