# Status

> Edit rules: the AI rewrites **Now** whenever the next step changes. The **Checklist** is tick-only: change `[ ]` to `[x]` and append `· date · commit · note link`. Never reword, reorder or delete items without asking.

## Now
- **Current:** M1 Catalog client (§4.4, and the M1 row of §7). Not started; no plan yet.
- **Last session:** 2026-10-26. Closed M0 ([note](milestones/2026-10-26-M0-scaffold.md)): context system, toolchain (TypeScript 7, Vitest 5, oxlint, Prettier), `loadConfig`, the Compose stack building catalog-api `v1.1.0` from its git tag, and CI (checked locally). ADRs 0001–0003 accepted. **Running:** the `catalog-agent` Compose stack on :3100, seeded (10,000 products).
- **Next step:** start M1. Check the docs that M1 depends on (Node 24 `fetch` and `AbortSignal.timeout`, Vitest fake timers), read §4.3–§4.5, ask the real decisions (how to simulate a timeout for the confirm-after-timeout path: a test-only proxy or a stopped container, §7), write the reliability ADR §4.4 asks for, and the M1 plan.
- **Carried from M0:**
  - M1: integration tests get their own name pattern and Vitest project (`npm test` and CI stay stack-free); test helpers stay out of `dist/`; the CI integration job; the first entry point loads `.env`.
  - M2: `.mcp.json` and the MCP SDK and zod installs; a stdio test that stdout carries only JSON-RPC (`no-console` can't see `process.stdout.write`).
  - M4: CI green on GitHub at the first push; install gitleaks; the MIT `LICENSE`. The user creates the GitHub repo after their go-ahead.
- **Outdated in `REQUIREMENTS.md` (found 2026-10-26):**
  - The MCP spec is now revision 2026-07-28 (stateless), and the official TypeScript SDK is v2, split into `@modelcontextprotocol/server` and `/client` (ADR-0002). §4 and §5 still read correctly at the level of tools, `structuredContent` and annotations; check each against the v2 docs in M2 and M3.
  - §3.2: list items from `GET /products` **do** carry `version` (checked live; the list ETag is weak, as the spec says). Decide in M2/M3 whether `get_product` stays the only source of `expectedVersion`.
- **Open questions / blockers:** none.

## Checklist
### Phase 1: the MCP server (§4)
- [x] M0 Scaffold · 2026-10-26 · 006e630..f548fd0 · [note](milestones/2026-10-26-M0-scaffold.md)
- [ ] M1 Catalog client
- [ ] M2 MCP server, read tools
- [ ] M3 Write tools
- [ ] M4 Phase 1 release

### Phase 2: the agent loop (§5; starts only after Phase 1 is published and the user says go)
- [ ] M5 Agent loop
- [ ] M6 Robustness
- [ ] M7 Evals
- [ ] M8 Phase 2 release
