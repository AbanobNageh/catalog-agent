# M3 Write tools
- Date: 2026-10-26 · Commits: f12f571, 759d9a8, 3b83da6 · Plan: [2026-10-26-M3-plan.md](2026-10-26-M3-plan.md) · Design: [ADR-0006](../adr/0006-write-tools.md)

## What was built
- **`CATALOG_ACCESS=read|write`** (`src/config.ts`):
  - the default is `write`; `.env.example` sets `read` next to the read key
  - with `read`, `createServer` never registers the write tools, so they aren't in `tools/list`, and a call to one is a JSON-RPC protocol error ("Tool set_stock not found")
  - the key's scope is the second layer: catalog-api answers a write with the read key with 403
- **`set_price` and `set_stock`** (`src/mcp/tools/conditional-set.ts`, and one small file each):
  - **Inputs:** `id`, an absolute value (`priceCents` or `stock`), `expectedVersion` (1 to int32 max) and `dryRun`, all required.
  - **Every call reads the product first.** Then:
    - **a version older than `expectedVersion`, on a real call:** a stale Redis copy, so `If-Match` decides
    - **any other version mismatch:** `STALE_VERSION`
    - **`dryRun`:** `{ current, proposed, wouldChange, version }`
    - **the value already there:** success, with `changed: false` and no `PATCH`
    - **otherwise:** the cancel signal is checked, then ADR-0004's conditional update, with exactly one field in the body
  - **Results** carry `previous`, `current`, the new `version` and `confirmedAfterTimeout`. Prices come in both forms, "799.00 EGP (79900)".
  - **Annotations:** destructive, idempotent, closed-world.
- **`create_product`:**
  - all the create fields, with catalog-api's bounds; `currency` is optional and `^[A-Z]{3}$`
  - never retried; a 409 is `SKU_EXISTS`
  - **after an unknown outcome,** its own hint: search by name and category, sorted newest first, and a retry with the same sku can't duplicate the product
  - **annotations:** additive, not idempotent
- **The tool layer:**
  - `runTool` takes per-tool hints and the SDK's cancel signal (`ctx.mcpReq.signal`)
  - `CatalogClient.updateProduct` checks the signal before its one retry
  - `get_product`'s mapping is shared with create
- **Tests:**
  - **Unit, 326** (up from 210):
    - the MCP-level write tests in both eras, on a shared harness (`src/testing/harness.ts`) whose fake catalog-api records each method, body and `If-Match`
    - the config, schema and hint tests
  - **Integration, 61** (up from 42), about 105 s:
    - `writes.int.test.ts`: 17 tests through the spawned stdio server
    - the contract check against `CreateProductDto`, `UpdateProductDto` and the `PATCH` parameters
    - the fault proxy gets `'pass'` and `{ before }` faults
- **Verified, 2026-10-26:**
  - unit, integration, lint, typecheck, format and build all pass
  - mutations, each caught and reverted:
    - write tools in read mode
    - a dry run that writes
    - no no-op check
    - no version check
    - no create hint
    - three kinds of contract drift
  - **MCP Inspector 2.12.0:** `--strict` clean with six tools; a create, a dry run, an apply and a stale replay worked live
  - **Inspector's timeout:** its CLI uses the SDK client's 60 s default, which covers a set call's worst case of about 57 s. This was read in its code, not measured
  - **Claude Code** (the user, in a second session):
    - finding low stock
    - a dry run, then an apply: refused with 403 while `.env` had the read key, successful with the write key
    - a planted concurrent change: `STALE_VERSION`

## Decisions
- **[ADR-0006](../adr/0006-write-tools.md), accepted at this close.** It records a research round: 13 well-known MCP servers' source, with seven key citations checked again by the AI.
- **The user's choices (2026-10-26):**
  - **`CATALOG_ACCESS` defaults to `write`,** like GitHub, Supabase and Grafana. The AI had recommended `read`, like AWS EKS.
  - **The set tools are destructive and idempotent,** like the reference filesystem server's `write_file` and Sentry's guide.
  - **A no-op is a success with nothing sent,** like Sentry's `update_issue`.
  - **Create's hint is reworded** so a model can follow it: §4.4's "search for the sku" is impossible, because `q` doesn't search skus.
  - **`.env.example`** sets `CATALOG_ACCESS=read`.
- **The AI's rulings:** the plan's ledger, 10 entries. Among them:
  - `dryRun` is required, and create has none
  - a dry run checks the version too
  - the version is checked before the value
  - results carry the next version
  - a stricter `currency`
  - no maximum string lengths, as in catalog-api
  - a flat output object rather than a union
- **Facts found:**
  - catalog-api's create DTO has no maximum string lengths, so `/docs-json` shows none
  - `If-Match` takes versions 1 to int32 max
  - every `PATCH` raises the version, even a no-op
  - `q` searches `name^3` and `description` only
  - `RedisCache.del` swallows its errors
  - the SDK answers an unknown tool with a protocol error
  - both protocol eras abort `ctx.mcpReq.signal` on cancellation

## Review findings and corrections
- **The fresh reviewer** (a separate agent: every suite except the pause test, Inspector, live probes, and 4 mutations in a temp copy) reported no Critical or Important findings and 6 Minor ones. Each is re-graded in the plan.
  1. **The first read trusts catalog-api's cached `GET`.**
     - A read *older* than `expectedVersion` refused a correct version. **Fixed test-first:** a real call now defers to `If-Match`.
     - A false no-op from a stale copy is documented in ADR-0006.
  2. **A cancelled call still wrote.** **Fixed test-first:** the signal is checked before the first `PATCH` and before the retry. The new tests failed first in both eras, which confirmed the finding live.
  3. **The 60 s margin only holds near the default timeout** (about 11 × `CATALOG_TIMEOUT_MS`). Documented in `.env.example` and ADR-0006.
  4. **Create's hint could lead to a duplicate product:** names repeat, and catalog-api swallows index failures. **Fixed test-first:** newest first, and "a retry with the same sku cannot create a duplicate". The integration test follows the hint, retries, and finds exactly one product.
  5. **A contract-check comment claimed checks that weren't there.** Reworded.
  6. **catalog-api's real 412 wasn't tested through the tools,** because our first read caught the planted update first. **Fixed:** a fault-proxy hook plants it just before the `PATCH`. A `PATCH` 500 is now tested end to end too.
- **The user's demo check:** the first apply failed with 403, because the user's `.env` was still M2's: the read key, with `CATALOG_ACCESS` unset, so `write`. That's ADR-0006's two layers working, and its documented downside: write tools the key can't use. The AI updated `.env`, and the retry succeeded.
- **The reviewer stayed in its copy.** It changed nothing in the real repo, which it checked with `git status`. Only Vitest's git-ignored cache under `node_modules` was written, through the copy's junction.
- **The AI's own mistakes:**
  - **The integration tests were written after the tools,** so they're proven by mutation, not by failing first.
  - **The demo instructions:** the AI told the user to edit `.env`, but only in prose before the prompts. The user ran the prompts with the old `.env` and hit the 403. The `.env` step should have been the first numbered action, as in M2's lesson about Claude Code and `.env`.
  - **A command wrote a temp file with `Set-Content`,** against `AGENTS.md`. It wasn't needed, and the file was removed.
  - **While fixing the review:**
    - an Edit missed because Prettier had re-wrapped the lines
    - the AI briefly imported a constant from a unit test file into the int test, which would have run that file's tests in the int project; it was reverted before any run
  - **`serverEnv()`'s promise:** a developer's `.env` couldn't change a test, until `CATALOG_ACCESS` existed. The AI noticed while writing the int tests and added a default.
  - **The first unit test for read mode accepted either error shape.** It was pinned to the SDK's protocol error after reading the SDK's code.

## Follow-ups
- **M4:**
  - **The README:**
    - §4.6's demo transcript, on `it-demo-m3`'s products or new ones. Capture whether Claude Code asks for approval before each write tool, and the model's wording after `STALE_VERSION`.
    - "two layers" for least privilege
    - why delete and reindex are never exposed
    - the 57 s worst case
    - the production story: idempotency keys or a lookup by SKU for create, and catalog-api's cache
  - **Delete the demo products** `IT-DEMO-M3-1..3` (category `it-demo-m3`) with the admin key after the demo.
- **M5:** the per-call timeout must allow about 11 × `CATALOG_TIMEOUT_MS`.
- **M6:**
  - log the calls the SDK rejects (carried from M2)
  - consider a bound on the total time of a set call
- **`REQUIREMENTS.md` is outdated** (for the user to approve):
  - §4.4's create hint
  - §4.2 doesn't say `dryRun` is required
  - §3.2: list items carry `version`, as M2 found
- **Unknown:** whether Claude Code applies its own approval prompts according to `destructiveHint`.
