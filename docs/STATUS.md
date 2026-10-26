# Status

> Edit rules: the AI rewrites **Now** whenever the next step changes. The **Checklist** is tick-only: change `[ ]` to `[x]` and append `· date · commit · note link`. Never reword, reorder or delete items without asking.

## Now
- **Current:** M0 Scaffold, started 2026-10-26. Plan: [2026-10-26-M0-plan.md](milestones/2026-10-26-M0-plan.md). Nothing committed yet; `git init -b main` done.
- **Last session:** 2026-10-26. Tasks 1–4, 6 and 7 built and verified (Task 5, `.mcp.json`, moved to M2). The user chose: `REQUIREMENTS.md` stays the spec, unsplit; ADRs numbered from 0001; this work is the start of M0; MCP SDK v2 2.4.0, TypeScript 7.0.2, Vitest 5.0.5, this repo's own Compose file building from git; CI checked locally now and on GitHub at M4. **Running:** the `catalog-agent` Compose stack on :3100, seeded (10,000 products). product-catalog's kind clusters were removed by the user.
- **Next step:** the fresh review ran and its findings are fixed or carried (plan, "Fresh review"), except the `.claude/settings.json` gaps, which are the user's call. Then the user's review of the tree (Task 1 included) and `close-milestone`.
- **Outdated in `REQUIREMENTS.md` (found 2026-10-26):** the MCP spec is now revision 2026-07-28 (stateless), and the official TypeScript SDK is v2, split into `@modelcontextprotocol/server` and `/client` (ADR-0002). §4 and §5 still read correctly at the level of tools, `structuredContent` and annotations; check each against the v2 docs in M2 and M3. Also §3.2: list items from `GET /products` **do** carry `version` (checked live 2026-10-26; the list ETag is weak, as the spec says), so decide in M2/M3 whether `get_product` stays the only source of `expectedVersion`.
- **Carried to later milestones:** CI green on GitHub (M4, at the first push); `.mcp.json` and the MCP SDK install (M2); `no-console` can't see `process.stdout.write`, so M2 adds a stdio test that stdout carries only JSON-RPC; M1: integration tests get their own name pattern and Vitest project (`npm test` and CI stay stack-free), test helpers stay out of `dist/`, and the first entry point loads `.env`.
- **Open questions / blockers:** none.

## Checklist
### Phase 1: the MCP server (§4)
- [ ] M0 Scaffold
- [ ] M1 Catalog client
- [ ] M2 MCP server, read tools
- [ ] M3 Write tools
- [ ] M4 Phase 1 release

### Phase 2: the agent loop (§5; starts only after Phase 1 is published and the user says go)
- [ ] M5 Agent loop
- [ ] M6 Robustness
- [ ] M7 Evals
- [ ] M8 Phase 2 release
