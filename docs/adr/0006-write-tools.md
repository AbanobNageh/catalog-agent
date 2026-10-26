# 0006. Write tools: access mode, annotations, dry runs, no-op writes

- **Status:** Accepted (approved at the M3 close, 2026-10-26)
- **Date:** 2026-10-26

## Context
- **M3 adds three write tools** over catalog-api `v1.1.0` (`REQUIREMENTS.md` §4.2): `create_product` (`POST /products`), and `set_price` and `set_stock` (`PATCH /products/:id` with `If-Match`). They go through M1's `CatalogClient`, whose conditional update confirms a write after a timeout (ADR-0004), and they return results and errors as M2 does (ADR-0005).
- **What the spec says** (revision 2026-07-28):
  - **Tool annotations** are hints about a tool's behaviour, for the host's approval prompts. Clients "MUST consider tool annotations to be untrusted unless they come from trusted servers".
    - `destructiveHint`: "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates." Default true.
    - `idempotentHint`: "If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment." Default false.
    - Both mean something only when `readOnlyHint` is false. `openWorldHint` defaults to true.
  - **The tool list** "MUST NOT vary per-connection", but may vary by authorization. A setting read once at startup changes nothing per connection.
- **What catalog-api `v1.1.0` does** (read at the tag):
  - the create DTO wants `sku`, `name`, `category` and `brand` as non-empty strings with no maximum length, `description` as any string, integers 0–2147483647, and an optional `currency` of 3 upper-case characters; unknown fields are rejected
  - `If-Match` takes one strong ETag from `"1"` to int32 max; anything else is a 400
  - **every `PATCH` raises the version, even one that changes nothing**, which weakens ADR-0004's confirm check
  - `q` searches `name` and `description` only (`search-service/internal/query/build.go`). `sku` is a keyword field that no search can reach, and there is no lookup by SKU.
- **What well-known servers do,** read in their source on 2026-10-26 (13 codebases, pinned commits; the key citations were checked again by the AI):
  - **The read-only switch.** Almost all default to writes on: GitHub's `--read-only` (default false, `cmd/github-mcp-server/main.go`), Supabase, Grafana's `--disable-write`, Azure, Sentry on stdio, Atlassian (community). AWS EKS is the exception: writes need `--allow-write` (default `False`). Most leave write tools out of `tools/list`; Grafana doesn't register them at all (`tools/dashboard.go`: `if enableWriteTools { UpdateDashboard.Register(s) }`). Supabase, Azure and Atlassian also refuse at call time.
  - **Create tools** are `destructiveHint: false`, `idempotentHint: false` almost everywhere: GitHub, Supabase, Grafana, Sentry's guide, the reference memory server.
  - **Update tools** are mostly `destructiveHint: true`: the reference filesystem server's `write_file`, Sentry (its guide: "Update tools (modify existing data)… destructiveHint: true, idempotentHint: true, // Same update twice = same result"), Grafana, Supabase, Azure, Atlassian, Notion, and GitHub by omission. GitHub's granular issue-field tools and Cloudflare say false.
  - **`idempotentHint` on updates** is split: true for filesystem `write_file`, Sentry's guide and Azure App Configuration `set`; false for Supabase and Grafana `update_annotation`. The maintainers' blog post on annotations (2026-03-16) reads `idempotentHint: true` as "Safe to retry on failure".
  - **Version arguments:** no server surveyed requires one. GitHub's file tool takes a `sha` that's "required if the file already exists", and its stale error names the current SHA and the next step, as our `STALE_VERSION` does.
  - **Dry runs:** only the reference filesystem server's `edit_file` has `dryRun` (optional, default false). Grafana and Supabase use two-step or confirm-tool flows.
  - **No-op updates:** Sentry's `update_issue` reads the issue first, drops fields that already match, and reports "No changes were needed" without calling the API.

## Considered options
1. **`CATALOG_ACCESS`'s default:** (a) `read`, so writes are opt-in (AWS EKS); (b) **`write`**, like most servers, with the key's scope as the limit; (c) `read`, plus a second `.mcp.json` entry for writes.
2. **The annotations on `set_price` and `set_stock`:** (a) **destructive and idempotent**; (b) destructive, not idempotent; (c) not destructive.
3. **A set call whose value is already there:** (a) **success, with nothing sent**; (b) refuse it with an error.
4. **After a create's outcome is unknown:** (a) **a hint the model can follow**; (b) the tool searches for the product itself; (c) §4.4's hint as written ("search for the sku").

## Decision
1(b), 2(a), 3(a), 4(a): the user's choices on 2026-10-26. 2–4 were as recommended. For 1, the AI recommended (a); the user chose (b).

**Access.** `CATALOG_ACCESS` is `read` or `write`, set in `.env` (or the environment), and **defaults to `write`**. Any other value is a config error at startup. With `read`, the write tools are never registered, so `tools/list` doesn't show them and a call to one is an unknown tool. There are two layers, and they're documented together:
- **this server:** `CATALOG_ACCESS` decides which tools exist
- **catalog-api:** the key's scope decides which calls succeed (`read` < `write` < `admin`). `write` with the read key is allowed: every write then gets the API's 403 as `FORBIDDEN`, with the API's message naming the scope it needs

`.mcp.json` sets neither, and never holds a key.

**Annotations.**
| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `create_product` | false | false (adds a product) | false (a repeat is `SKU_EXISTS`, or a second product if the SKU differs) | false |
| `set_price`, `set_stock` | false | true (overwrites the old value) | true: a repeat with the same `expectedVersion` gets `STALE_VERSION` and changes nothing | false |

`openWorldHint` stays false, as on the read tools: one fixed catalogue, not the open web. The read tools keep M2's annotations.

**The set tools** (`set_price`, `set_stock`):
- **Inputs:** `id` (a UUID), the absolute value (`priceCents` or `stock`: an integer, 0–2147483647; no deltas), `expectedVersion` (an integer, 1–2147483647) and `dryRun` (a boolean). All four are required, so the model chooses a dry run or a write every time. Only that one field is ever sent: the `PATCH` body is `{ "stock": 50 }`, never a field set to `undefined`.
- **Every call reads the product first** (`GET /products/:id`, with the read retries). Then:
  1. **Its version is older than `expectedVersion`, on a real call:** go straight to step 4. Versions only go up, so an older read means catalog-api's Redis copy is lagging a write: its cache delete can fail without an error. Neither the read's version nor its value can be trusted, so `If-Match` decides, and its 412 also clears the stale copy. Added after the M3 review.
  2. **Its version isn't `expectedVersion`** (newer, or older on a dry run): `STALE_VERSION` with the version read, the same as catalog-api's own 412. That includes a dry run, so a preview also says whether the real call would go through.
  3. **`dryRun: true`:** return `{ current, proposed, wouldChange, version }` (§4.2). Nothing is written. **The value is already there, on a real call:** success, with `changed: false`. No `PATCH` is sent, so the version doesn't move and ADR-0004's confirm check stays sound.
  4. **Otherwise:** the conditional update (ADR-0004), then success with the previous and new values, the new version, and `confirmedAfterTimeout`.
- **Cancellation:** when the MCP client cancels the call (`notifications/cancelled` in 2025, or a dropped request in 2026-07-28; the handler's `ctx.mcpReq.signal` aborts), no further `PATCH` is sent. That's checked before the first `PATCH` and before the client's one retry. A `PATCH` already in flight is never aborted: whether it lands is settled by the re-read, as before. Added after the M3 review.
- **The result carries the version to send next,** so one change can follow another without a new `get_product`.

**`create_product`:**
- All the create fields, with catalog-api's bounds. `currency` is optional (catalog-api defaults it to EGP) and must be three letters A–Z, slightly stricter than catalog-api's "3 upper-case characters", which also allows digits.
- No `dryRun`: §4.2 asks for it on the set tools only, and a preview of a create couldn't check whether the SKU is taken.
- Never retried (ADR-0004). A 409 is `SKU_EXISTS`. After a timeout, a 503 or a connection error, the hint is: "the product may have been created. Call search_products with q set to its name, category set to its category and sort newest, and look for its sku in the hits. If it is not there, retry with the same sku: that cannot create a duplicate, and SKU_EXISTS then means the product was created. Never change the sku to get past SKU_EXISTS".
  - The M3 review found the first wording could lead to a duplicate: names repeat, and catalog-api swallows index failures, so the search can miss a product that exists. Newest first puts a new product on the first page, and the unique sku makes a same-sku retry safe.

## Consequences
- **Good:**
  - least privilege can be configured in two independent places, and the read-only mode really removes the tools
  - a dry run and a real call agree, because they make the same checks
  - a model that repeats a set call (or a host that retries it because of `idempotentHint`) can't apply it twice: the second call gets `STALE_VERSION`, whose hint says to re-read the product
  - no no-op writes, so the version means "something changed"
- **Bad:**
  - **the default is writes on.** A fresh `.env` registers the write tools, and the read key's 403 is what stops the writes
  - every set call costs one extra read (a few ms). **The worst case for one set call** is about 11 × `CATALOG_TIMEOUT_MS` + 1.8 s: the first read (3 tries plus backoff), then two `PATCH`es and two re-reads, all at their timeouts. At the default 5 s that rises from about 41 s (ADR-0004) to about 57 s. That's under the SDK client's 60 s default (Inspector's CLI uses it too), with little margin, and only during an outage. Above about 5.3 s, the worst case passes 60 s, and a client may give up while the server still settles the write. `.env.example` says so. M5's per-call timeout must allow for it
  - **the first read trusts catalog-api's cached `GET`** (Redis, 5 minutes). A copy that's stale *and* matches the model's own stale view can give a false no-op ("already 50; nothing was written") without a `PATCH`. That needs a failed cache delete on catalog-api's side, and `get_product` would show the same stale copy. A read *older* than `expectedVersion` is handled (step 1). Found by the M3 review
  - after the first read, another client can still change the product before our `PATCH`. `If-Match` catches that as a 412 (`STALE_VERSION`)
  - **the create hint is a search by name, not by SKU,** so it's a check the model has to make by eye. A real fix needs catalog-api to add a lookup by SKU or idempotency keys, a production follow-up (ADR-0004)
- **`REQUIREMENTS.md` is outdated in two places:**
  - §4.4's create hint ("search for the sku") can't be followed
  - §4.2 doesn't say `dryRun` is required

## Revisit when
catalog-api adds a lookup by SKU or idempotency keys, the server gets more than one user per process (Streamable HTTP with per-request authorization, where the spec lets the tool list follow the caller's scopes), or the spec defines what clients may do with `idempotentHint`.
