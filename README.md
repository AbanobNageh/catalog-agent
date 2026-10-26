# catalog-agent

An **MCP server** for a product catalogue: it lets an MCP client over stdio (tested with Claude Code and MCP Inspector) search products and change their price and stock, safely. It's TypeScript on the official MCP SDK v2, over the catalogue API from my sister repo [product-catalog](https://github.com/AbanobNageh/product-catalog) at its `v1.1.0` tag. Phase 2 will add my own tool-calling agent loop on top, with OpenRouter models and real-model evals.

It's also a record of how I work with an AI coding assistant (Claude Code): what it wrote, what I decided and checked, and where it got things wrong.

![Claude Code restocks low-stock books through this server, then recovers from a planted concurrent change](docs/demo/restock.gif)

*Claude Code finds low-stock books, dry-runs a restock, applies it after I confirm, then hits a change someone else made in between (`STALE_VERSION`) and asks me before overwriting it. [Full transcript](docs/demo/transcript.md).*

## At a glance

- **Who I am:** a backend engineer (about 5.5 years: NestJS/TypeScript, Go, PostgreSQL, Redis, OpenSearch). I'd used MCP servers but never built one. This is a personal project.
- **Status:** Phase 1, the MCP server, is released as `v0.1.0` (milestones M0–M4). Phase 2, the agent loop and its evals, comes next.
- **What it shows:**
  - six tools designed for a model as the reader: bounded inputs, small outputs, errors that say how to recover
  - least privilege in two layers: write tools exist only when configured, and the API key's scope limits every call; delete and reindex are never exposed
  - writes that are never blindly retried: version-checked updates, dry runs, and a confirm-after-timeout path that can't apply a write twice
  - tests without an LLM: 327 unit and MCP-level tests, and 61 integration tests against the real API, about half of them through the spawned stdio server
- **Who did what:**

  | | The AI (Claude Code) | Me |
  |---|---|---|
  | Spec | | Wrote the brief, [REQUIREMENTS.md](REQUIREMENTS.md) |
  | Design | Read the official docs and the code; researched how well-known MCP servers solve the same problems; proposed the options | Made every decision ([ADRs](docs/adr/)); chose against its recommendation where I disagreed |
  | Build | Wrote all the code, tests, CI and docs, one planned milestone at a time | Reviewed every milestone: the tour, the files, the reviewer's findings |
  | Checks | Ran every suite and mutation check; a separate AI reviewer checked each milestone's whole diff | Ran the demos in Claude Code and MCP Inspector |

- **Proof:** a plan and a note per milestone in [docs/milestones/](docs/milestones/), six [ADRs](docs/adr/), [what the review loop caught](docs/ai-workflow.md#what-the-review-loop-caught), and a co-author trailer on every commit made with the AI.

## Architecture

```
 Claude Code / MCP Inspector / any stdio host     the MCP host and client
                     │  MCP over stdio: JSON-RPC on stdin/stdout, logs on stderr
                     ▼
 ┌───────────────────────────────────────────────┐
 │ catalog-agent MCP server (Node 24, this repo) │  6 tools; CATALOG_ACCESS=read|write
 │   tools → CatalogClient: timeouts, read       │
 │   retries, conditional writes                 │
 └──────────────────────┬────────────────────────┘
                        │  HTTP, Authorization: Bearer <key> (read or write scope)
                        ▼
          catalog-api v1.1.0 (NestJS) ──── PostgreSQL, Redis
                        │
          search-service (Go) ──────────── OpenSearch
```

How it works, in detail (the MCP basics, the tools, errors, reliability, tests): [docs/how-it-works.md](docs/how-it-works.md).

## Run it

Windows 11 with Docker Desktop (WSL2, at least 8 GB), Node 24, PowerShell. Every command, with what to expect, is in [AGENTS.md](AGENTS.md) under "Commands".

1. **Create `.env` first:** `Copy-Item .env.example .env`. It holds the read key and `CATALOG_ACCESS=read`: the three read tools. For the write tools, change both lines: `CATALOG_ACCESS=write` and the write key, `dev-write-key-not-secret-000000000000000`. The dev keys are public, from product-catalog, and not secret.
2. **Start the catalogue and seed it** (the first build takes about 3 minutes):
   ```powershell
   docker compose up --build -d --wait
   docker compose run --rm -e CATALOG_API_URL=http://catalog-api:3000 -e CATALOG_API_KEY=dev-admin-key-not-secret-000000000000000 catalog-api node dist/seed/main.js
   ```
3. **Build the server:** `npm ci`, then `npm run build`.
4. **Claude Code:** run `claude` in this folder and approve the `catalog` server ([.mcp.json](.mcp.json)); check it with `/mcp`. Then ask, for example: *"Find books with 5 or fewer in stock, lowest stock first."* After editing `.env`, reconnect from `/mcp`.
5. **MCP Inspector** (no LLM):
   ```powershell
   npx -y @modelcontextprotocol/inspector@2.12.0 --cli --config .mcp.json --server catalog --method tools/call --tool-name search_products --tool-arg category=books maxStock=5 sort=stock_asc size=3
   ```
   Leave out `--cli` for the web UI.
6. **Tests:** `npm test` (no stack needed) and `npm run test:int` (against the running stack, about 2 minutes).

## The tools

| Tool | Access | What it does |
|---|---|---|
| `search_products` | read | Filtered search (text, category, brand, price, `maxStock`, sort), compact hits and paging |
| `get_product` | read | One product in full, with the `version` a change must send back |
| `list_facets` | read | Categories, brands and price buckets with counts, so the model learns valid filters |
| `create_product` | write | Adds a product; never retried |
| `set_price`, `set_stock` | write | Sets an absolute value with `expectedVersion` and a required `dryRun` |

- **Errors are results the model can act on:** a code, whether to retry, and a hint, often naming the next tool call. A stale version is `STALE_VERSION` with the current version.
- **Reliability:** reads retry with jittered backoff; writes never retry blindly. After a timeout, a set call re-reads the product and decides from its version whether the write landed. [ADR-0004](docs/adr/0004-catalog-client-reliability.md).

## Design decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-tiered-ai-context-system.md) | A tiered context system for the AI assistant |
| [0002](docs/adr/0002-toolchain-version-pins.md) | Toolchain and pins: MCP SDK v2, TypeScript 7, Vitest 5 |
| [0003](docs/adr/0003-catalog-stack-from-git-tag.md) | catalog-api `v1.1.0` from this repo's own Compose file, built from the git tag |
| [0004](docs/adr/0004-catalog-client-reliability.md) | Read retries, conditional writes, confirm after a timeout |
| [0005](docs/adr/0005-mcp-tool-results-and-errors.md) | Tool results: text and structured content, errors, pagination, protocol eras |
| [0006](docs/adr/0006-write-tools.md) | Write tools: access mode, annotations, dry runs, no-op writes |

## What I'd change in production

A remote server over Streamable HTTP with OAuth 2.1 (no token passthrough to the API); a lookup by SKU or idempotency keys for create; a cache-bypassing read before a write; a deadline for a whole set call; an error schema once the MCP spec has one; OpenTelemetry traces and per-caller rate limits. Details: [how-it-works.md](docs/how-it-works.md#what-id-change-in-production).

## How the AI was used

- **The loop, per milestone:** the AI read the code and docs and asked me the real decisions; it wrote an ADR and a plan, built test-first with nothing committed, and a **fresh AI reviewer** checked the whole diff before I reviewed it. The context system behind it: [docs/ai-workflow.md](docs/ai-workflow.md).
- **Its mistakes are recorded,** with who caught them, in [what the review loop caught](docs/ai-workflow.md#what-the-review-loop-caught). For example:
  - it missed a key-leak path its sister repo had already closed (found by the reviewer)
  - it built error results on the SDK's behaviour without checking a second client; my demo in Inspector showed they broke the spec
  - a cancelled write call still wrote (found by the reviewer)

## License

[MIT](LICENSE)
