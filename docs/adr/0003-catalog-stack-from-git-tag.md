# 0003. Run catalog-api v1.1.0 from this repo's own Compose file, built from the git tag

- **Status:** Accepted (approved at the M0 close, 2026-10-26)
- **Date:** 2026-10-26

## Context
- The MCP server needs a running catalogue: Postgres, Redis, OpenSearch, the one-shot `migrate` job, search-service and catalog-api, seeded with 10,000 products (`REQUIREMENTS.md` §3.3).
- It must run **catalog-api `v1.1.0`** (tag → commit `50f9430`, checked with `git ls-remote` on 2026-10-26) without changing product-catalog.
- product-catalog's own `docker-compose.yml` at `v1.1.0`:
  - publishes host ports 3000, 5432, 6379 and 9200, and has project name `product-catalog`
  - builds from relative paths (`services/catalog-api`, `services/search-service`)
  - tags its images `catalog-api:0.2.0`, `catalog-api-migrate:0.2.0` and `search-service:0.2.0`. The same names exist locally, built from product-catalog's working copy, and its kind clusters load them by name (product-catalog ADR-0014).
- This repo's stack must use project name `catalog-agent` and publish only catalog-api, on **3100** (§2.6).
- BuildKit accepts a git URL as a build context, with a ref and a subdirectory: `https://github.com/AbanobNageh/product-catalog.git#v1.1.0:services/catalog-api`.

## Considered options
1. **This repo's own `docker-compose.yml`.** Copy the settings that matter from `v1.1.0` (images and versions, OpenSearch's `action.auto_create_index: "-products*,+*"`, the healthchecks, the `depends_on` conditions, the migrate job, the dev keys), and point each `build.context` at the git URL with `#v1.1.0:<subdir>`.
2. **Compose `include` of the remote file at `v1.1.0`,** plus an override file that removes the host ports (`!reset`), adds 3100, renames the images, and sets the project name.

## Decision
**Option 1**, the user's choice on 2026-10-26.
- `name: catalog-agent`. Only `catalog-api` publishes a port: `3100:3000`.
- Images get this repo's names, so they can't overwrite product-catalog's local images: `catalog-agent-catalog-api:v1.1.0`, `catalog-agent-catalog-api-migrate:v1.1.0`, `catalog-agent-search-service:v1.1.0`.
- `migrate` builds the same git context with `target: migrate`.
- Volumes are prefixed by the project name (`catalog-agent_postgres-data`, `catalog-agent_opensearch-data`), so they're separate from product-catalog's.
- The OpenSearch Dashboards profile isn't copied: nothing here needs it.
- A comment at the top names the tag, its commit, and the date the settings were copied.

## Consequences
- Good: the file is readable on its own, and every host port, image name and volume is under this repo's control.
- Good: the tag shows in the image names, so `docker images` tells you which catalog-api you're running.
- Bad: copied settings can drift from product-catalog's if a new tag changes them. Moving to a new tag means re-reading that tag's Compose file, and is a deliberate change.
- Bad: a git tag can be moved. The commit is noted in the file; pinning the build context to the commit instead would make that explicit, at the cost of readability.
- Bad: the first build clones the repo and builds three images (several minutes, plus a 1.2 GB OpenSearch image). The M2 contract check (`/docs-json`) catches API drift that this file can't.
- Option 2 was rejected because the override needs `!reset` on ports and image names, which hides the effective config across two files, and it depends on Compose's remote-include support.

## Revisit when
This repo moves to a newer catalog-api tag.
