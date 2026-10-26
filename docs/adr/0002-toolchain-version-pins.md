# 0002. Toolchain and version pins: MCP SDK v2, TypeScript 7, Vitest 5

- **Status:** Accepted (approved at the M0 close, 2026-10-26)
- **Date:** 2026-10-26

## Context
Checked on the npm registry and the official docs on 2026-10-26, at the start of M0 (`REQUIREMENTS.md` §2.4 asks for exact pins recorded in an ADR, as in product-catalog ADR-0004):
- **The MCP spec has a new revision, 2026-07-28** (final on 2026-07-28; [announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). It makes the protocol core stateless: no `initialize` handshake and no sessions, with the revision negotiated per request. It's not backward compatible on the wire, so SDKs serve both "eras".
- **The official TypeScript SDK has split.** v2 (stable since 2.0.0 on 2026-07-27; 2.4.0 on 2026-10-23) is `@modelcontextprotocol/server`, `@modelcontextprotocol/client` and `@modelcontextprotocol/core`, and implements 2026-07-28. Its `serveStdio(() => createServer())` entry point also serves 2025-era clients (`initialize`) from the same server, by default ([stdio guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio), [protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html)). The old single package `@modelcontextprotocol/sdk` is still published (1.32.2, 2026-10-23) and speaks only the 2025 revisions. MCP Inspector 2.12.0 depends on v2.
  - v2 needs **Zod 4** (≥ 4.2; Zod 3 is "no longer supported") and Node ≥ 20. It's ESM-first with a CommonJS build. stdio transports come from the `/stdio` subpaths, and an `InMemoryTransport` exists for tests.
  - Most tutorials and examples online are still written for v1.
- **TypeScript 7.0.2** (the native Go port, 2026-07-08) is npm `latest`; 6.0.3 is the last 6.x. product-catalog stayed on 6.0.3 only because `@nestjs/swagger` 12 doesn't support 7 (product-catalog ADR-0004). Nothing planned here uses TypeScript's JavaScript API: Vitest strips types with its own transformer, and oxlint's type-aware mode runs on `oxlint-tsgolint`, which is itself built on the Go port.
- **Vitest 5.0.5** (5.0.0 on 2026-09-03) and **Jest 30.5.2** are current. Jest with ESM TypeScript needs `ts-jest` (TypeScript's JS API) or Node's `--experimental-vm-modules` flag, as product-catalog found.
- Lint and format: product-catalog uses **oxlint 1.89.0** (with `oxlint-tsgolint`, now 7.0.2005) and **Prettier 3.9.10**; both are still current.
- Local: Node 24.21.0, npm 11.19.0.

## Considered options
1. **MCP SDK:** (a) **v2, 2.4.0**; (b) v1, 1.32.2.
2. **TypeScript:** (a) **7.0.2**; (b) 6.0.3.
3. **Test runner:** (a) **Vitest 5.0.5**; (b) Jest 30.5.2.
4. **How the server runs:** (a) **`tsc` builds `src/` to `dist/`, and `node dist/...` runs it** (also from `.mcp.json`); (b) Node 24's built-in type stripping runs `src/*.ts` directly, with no build step. (b) needs erasable-only syntax and `.ts` import extensions, and prints an experimental warning on each start.
5. **Module system:** (a) **ESM** (`"type": "module"`, `module: nodenext`); (b) CommonJS.

## Decision
1(a), 2(a), 3(a): the user's choices on 2026-10-26, all as recommended. 4(a) and 5(a) are the AI's recommendation, the most ordinary setup for a Node CLI in 2026.

| Package | Pin | Role |
|---|---|---|
| Node | 24.x (`engines: ^24.0.0`), CI on 24 | runtime. Not 25: Vitest 5 supports `^22.12 \|\| ^24 \|\| >=26` |
| npm | 11 | `save-exact=true` in `.npmrc`; `package-lock.json` committed |
| `typescript` | 7.0.2 | `tsc` for the build and `tsc --noEmit` typecheck |
| `@modelcontextprotocol/server` | 2.4.0 | the MCP server (M2) |
| `@modelcontextprotocol/client` | 2.4.0 | MCP-level tests (M2) and the agent's MCP client (M5) |
| `zod` | 4.6.7 | tool input and output schemas (v2's Standard Schema input), from M2. M0's `loadConfig` is plain TypeScript |
| `vitest` | 5.0.5 | unit, MCP-level and integration tests; fake timers for backoff |
| `oxlint` / `oxlint-tsgolint` | 1.89.0 / 7.0.2005 | lint, type-aware |
| `prettier` | 3.9.10 | format |
| `@types/node` | 24.19.2 | Node 24 types (TypeScript ≥ 6 needs `"types": ["node"]`) |

Each package is installed in the milestone that first uses it, at the version above, unless that milestone's version check finds a reason to move (then this table gets a superseding ADR, not an edit).

## Consequences
- Good: the server speaks the current spec and still works with every 2025-era client (Claude Code, Claude Desktop, older Inspectors) through one entry point.
- Good: the Phase 2 agent's MCP client comes from the same release line as the server.
- Good: no flags or transformer workarounds for ESM tests; fast typechecks.
- Bad: v2 is three months old and moving (2.0 → 2.4 in three months). Every API is checked against the v2 docs, not tutorials, and minor bumps are a deliberate change.
- Bad: which protocol revision a given client actually negotiates (2025-11-25 or 2026-07-28) affects the wire encoding of structured results. The M2 MCP-level tests should cover both eras, if the SDK's in-memory transport lets the client pick.
- Bad: TypeScript 7 is the first native major. If `tsc` 7 or tsgolint fails on the scaffold, fall back to 6.0.3 and record it here before the close.
- `.mcp.json` (M2) will need `npm run build` before Claude Code can start the server. The README and `AGENTS.md` must say so when it's added.

## Revisit when
The v2 SDK ships a new major, or the next MCP spec revision is published.
