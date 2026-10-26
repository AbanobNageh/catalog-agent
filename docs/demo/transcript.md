# Demo transcript: restocking low-stock books, with a planted conflict

The session behind [restock.gif](restock.gif), the `REQUIREMENTS.md` §4.6 demo: Claude Code finds low-stock books, dry-runs a restock, applies it after the user confirms, and recovers from a planted `STALE_VERSION`.

## How it was recorded (2026-10-26)
- **Client:** Claude Code v2.1.310, Opus 5.5 at high effort, **manual permission mode** (it asks before every tool call). The user's own session.
- **From a folder outside this repo,** `D:\Projects\catalog-demo`, so the model saw none of this repo's instructions or status files. The server came from a config file passed on the command line:
  ```powershell
  claude --mcp-config catalog-mcp.json --strict-mcp-config --permission-mode manual
  ```
  ```json
  { "mcpServers": { "catalog": { "type": "stdio", "command": "node", "args": ["D:\\Projects\\catalog-agent\\dist\\main.js"] } } }
  ```
  The server reads the repo's `.env` by its own location: the public dev write key and `CATALOG_ACCESS=write`.
- **The backend:** this repo's Compose stack (catalog-api `v1.1.0`) with the 10,000 seed products, plus three test products from the M3 demo (category `it-demo-m3`), hence the 10,003 in the first result. They were deleted after the recording. Both books had already been through earlier takes, which is why their versions start at 9 and 10. Between takes, the AI set their stock back to 0; versions only go up.
- **The prompts** were pasted from a helper script, one per step, rather than typed.
- **The planted conflict:** after the second dry run, the user ran this from a separate PowerShell window: a second client sets the stock to 3 with the write key, without `If-Match`.
  ```powershell
  Invoke-RestMethod -Method Patch -Uri "http://localhost:3100/products/0173315d-f7f9-49c8-82b4-8aee62533881" -Headers @{ Authorization = 'Bearer dev-write-key-not-secret-000000000000000' } -ContentType 'application/json' -Body '{"stock":3}'
  ```
- **Approvals:** Claude Code showed a permission prompt before every tool call, read tools included: `list_facets`, `search_products`, `get_product` and `set_stock`, dry runs too. The session log records each one as approved once by the user. Each prompt shows the tool's description and arguments and offers "Yes", "Yes, and don't ask again for catalog – … in D:\Projects\catalog-demo" and "No". The user answered "Yes" each time. See the GIF.

## What is quoted, and what was cut
- **The user's prompts and the model's replies** are verbatim from Claude Code's `/export`. Only the line wraps changed, and the export's box tables are written as Markdown tables.
- **The tool calls and results** are verbatim from the session's log (`~/.claude/projects/.../<session>.jsonl`), because `/export` folds them into "Called catalog 3 times". Long results are cut, marked `[…]`.
- **Cut entirely:** Claude Code's own `ToolSearch` calls, which load the catalog tools' schemas before their first use, and its timing lines ("Brewed for 11s").
- **What the model received** for a successful call was the `structuredContent` JSON alone. The log shows Claude Code passed it on, not the text block with our one-line summary ([ADR-0005](../adr/0005-mcp-tool-results-and-errors.md)). For the error, which has no `structuredContent`, it received the text block.

---

### 1. Find low-stock books

> **User:** Find books with 5 or fewer in stock, lowest stock first. Show the top 5 with SKU, name, stock and price.

`list_facets {}`
```json
{"total":10003,"categories":[{"key":"sports","count":1054},{"key":"fashion","count":1042},{"key":"kitchen","count":1022},{"key":"toys","count":1010},{"key":"beauty","count":988},{"key":"books","count":986}, […] ],"brands":[ […] ],"priceBuckets":[ […] ]}
```

`search_products {"category":"books","maxStock":5,"sort":"stock_asc","size":5}`
```json
{"hits":[{"id":"01150e76-a154-4f63-a9b7-497146a129f0","sku":"SEED-04007","name":"Nitzsche Fantastic Novel 6","category":"books","brand":"Nitzsche","priceCents":88900,"price":"889.00 EGP","currency":"EGP","stock":0},{"id":"0173315d-f7f9-49c8-82b4-8aee62533881","sku":"SEED-04575","name":"Bahringer Gorgeous Textbook 5","category":"books","brand":"Bahringer","priceCents":44500,"price":"445.00 EGP","currency":"EGP","stock":0}, […three more hits…] ],"total":118,"page":1,"size":5,"hasMore":true,"nextPage":2}
```

`list_facets {"category":"books","maxStock":0}`
```json
{"total":94,"categories":[{"key":"books","count":94}],"brands":[ […] ],"priceBuckets":[ […] ]}
```

**Claude:** Here are the top 5 books with 5 or fewer in stock, lowest stock first:

| SKU | Name | Stock | Price |
|---|---|---|---|
| SEED-04007 | Nitzsche Fantastic Novel 6 | 0 | 889.00 EGP |
| SEED-04575 | Bahringer Gorgeous Textbook 5 | 0 | 445.00 EGP |
| SEED-05689 | Carter Ergonomic Textbook 6 | 0 | 81.00 EGP |
| SEED-00530 | Reichel Electronic Comic 10 | 0 | 915.00 EGP |
| SEED-13efe1c0… → SEED-06066 | Bednar Fantastic Poetry Collection 9 | 0 | 45.00 EGP |

118 books have 5 or fewer in stock, and 94 of those have none at all. So these 5 aren't really the "lowest" in any useful way. They're just the first 5 of 94 tied at zero, and the catalogue breaks ties by internal product ID. Two other ways to cut this might be more useful:

- Books that are low but still in stock (1–5 units): there are 24 of them.
- The out-of-stock books ranked by price, so the most valuable ones come first.

*(The last SKU cell is the model's slip: it mixed the product's id, `13efe1c0-…`, into the SKU column. It corrects this itself in the next reply.)*

### 2. Dry-run a restock

> **User:** Restock SEED-04007 to 40 units. Do a dry run first, and don't apply anything until I confirm.

`get_product {"id":"01150e76-a154-4f63-a9b7-497146a129f0"}`
```json
{"id":"01150e76-a154-4f63-a9b7-497146a129f0","sku":"SEED-04007","name":"Nitzsche Fantastic Novel 6","description":"Our deer-friendly Hat ensures optimistic comfort for your pets","category":"books","brand":"Nitzsche","priceCents":88900,"price":"889.00 EGP","currency":"EGP","stock":0,"createdAt":"2026-01-05T11:29:16.880Z","updatedAt":"2026-10-26T10:03:13.205Z","version":9}
```

`set_stock {"id":"01150e76-a154-4f63-a9b7-497146a129f0","stock":40,"expectedVersion":9,"dryRun":true}`
```json
{"dryRun":true,"id":"01150e76-a154-4f63-a9b7-497146a129f0","sku":"SEED-04007","name":"Nitzsche Fantastic Novel 6","current":{"stock":0},"proposed":{"stock":40},"wouldChange":true,"version":9}
```

**Claude:** I ran the dry run and nothing has been written yet.

| | |
|---|---|
| Product | SEED-04007 · Nitzsche Fantastic Novel 6 |
| Current stock | 0 |
| Proposed stock | 40 (sets the total to 40, doesn't add 40) |
| Would change | Yes |
| Version | 9 |

Say "confirm" and I'll apply it. If someone else changes this product before then, the update will be rejected rather than overwrite their change. In that case I'll read it again and check with you before trying again.

One correction to my earlier table: the last row's SKU cell was garbled. It should just say SEED-06066 (Bednar Fantastic Poetry Collection 9).

### 3. Apply it after the user confirms

> **User:** Looks good, apply it.

`set_stock {"id":"01150e76-a154-4f63-a9b7-497146a129f0","stock":40,"expectedVersion":9,"dryRun":false}`
```json
{"dryRun":false,"id":"01150e76-a154-4f63-a9b7-497146a129f0","sku":"SEED-04007","name":"Nitzsche Fantastic Novel 6","previous":{"stock":0},"current":{"stock":40},"changed":true,"version":10,"confirmedAfterTimeout":false}
```

**Claude:** SEED-04007 (Nitzsche Fantastic Novel 6) now has 40 units in stock, up from 0. The product's version is now 10.

### 4. A second dry run, then a planted concurrent change

> **User:** Now the same for SEED-04575: a dry run to 25 units, and wait for my confirmation.

`get_product {"id":"0173315d-f7f9-49c8-82b4-8aee62533881"}`
```json
{"id":"0173315d-f7f9-49c8-82b4-8aee62533881","sku":"SEED-04575","name":"Bahringer Gorgeous Textbook 5", […] ,"stock":0,"createdAt":"2026-07-18T20:02:57.034Z","updatedAt":"2026-10-26T10:03:13.637Z","version":10}
```

`set_stock {"id":"0173315d-f7f9-49c8-82b4-8aee62533881","stock":25,"expectedVersion":10,"dryRun":true}`
```json
{"dryRun":true,"id":"0173315d-f7f9-49c8-82b4-8aee62533881","sku":"SEED-04575","name":"Bahringer Gorgeous Textbook 5","current":{"stock":0},"proposed":{"stock":25},"wouldChange":true,"version":10}
```

**Claude:** I ran the dry run and nothing has been written yet.

| | |
|---|---|
| Product | SEED-04575 · Bahringer Gorgeous Textbook 5 |
| Current stock | 0 |
| Proposed stock | 25 (sets the total to 25, doesn't add 25) |
| Would change | Yes |
| Version | 10 |

Say "confirm" and I'll apply it. As before, if the product changes in the meantime, the update will be rejected and I'll check with you again.

*(Here the user ran the plant from the other window: stock 0 → 3, version 10 → 11, at 10:06:51 UTC.)*

### 5. The apply meets `STALE_VERSION`, and the model recovers

> **User:** Apply it.

`set_stock {"id":"0173315d-f7f9-49c8-82b4-8aee62533881","stock":25,"expectedVersion":10,"dryRun":false}`, an error result (`isError: true`):
```
Error STALE_VERSION: product changed: you sent version 10, current is 11. Hint: the product changed (current version 11); call get_product, check the change still makes sense, then retry with expectedVersion 11.

{"code":"STALE_VERSION","message":"product changed: you sent version 10, current is 11","retryable":true,"hint":"the product changed (current version 11); call get_product, check the change still makes sense, then retry with expectedVersion 11","details":{"currentVersion":11}}
```

`get_product {"id":"0173315d-f7f9-49c8-82b4-8aee62533881"}`
```json
{"id":"0173315d-f7f9-49c8-82b4-8aee62533881","sku":"SEED-04575","name":"Bahringer Gorgeous Textbook 5", […] ,"stock":3,"createdAt":"2026-07-18T20:02:57.034Z","updatedAt":"2026-10-26T10:06:51.274Z","version":11}
```

`set_stock {"id":"0173315d-f7f9-49c8-82b4-8aee62533881","stock":25,"expectedVersion":11,"dryRun":true}`
```json
{"dryRun":true,"id":"0173315d-f7f9-49c8-82b4-8aee62533881","sku":"SEED-04575","name":"Bahringer Gorgeous Textbook 5","current":{"stock":3},"proposed":{"stock":25},"wouldChange":true,"version":11}
```

**Claude:** I didn't apply it. The update was rejected because someone else changed this product after my dry run, so nothing was written.

What changed: SEED-04575's stock went from 0 to 3 at 10:06:51 today. The product's version went from 10 to 11. Price, name and everything else are the same.

I ran a new dry run against the current version:

| | |
|---|---|
| Product | SEED-04575 · Bahringer Gorgeous Textbook 5 |
| Current stock | 3 (was 0 when you approved) |
| Proposed stock | 25 |
| Would change | Yes |
| Version | 11 |

Before I apply anything, which do you want?

- Set it to 25, as you originally asked. This replaces the 3 that were just recorded.
- Set it to 28, if your 25 units are a delivery separate from those 3.
- Leave it, if the person who changed it is already handling this item.

> **User:** Still set it to 25.

`set_stock {"id":"0173315d-f7f9-49c8-82b4-8aee62533881","stock":25,"expectedVersion":11,"dryRun":false}`
```json
{"dryRun":false,"id":"0173315d-f7f9-49c8-82b4-8aee62533881","sku":"SEED-04575","name":"Bahringer Gorgeous Textbook 5","previous":{"stock":3},"current":{"stock":25},"changed":true,"version":12,"confirmedAfterTimeout":false}
```

**Claude:** SEED-04575 (Bahringer Gorgeous Textbook 5) now has 25 units in stock, replacing the 3 that had just been recorded. The product's version is now 12.

You might want to tell whoever entered those 3 units that you've set the total to 25.

---

## What the demo showed
- **Discovery before filtering:** the model called `list_facets` first, to see the valid category names, then searched. A second `list_facets` with `maxStock: 0` gave it the 94 tied at zero.
- **The dry run and the real call agree:** the same checks, the same version ([ADR-0006](../adr/0006-write-tools.md)).
- **`STALE_VERSION` did its job:** the planted change was never overwritten blindly. The model followed the hint (re-read, then a new dry run against version 11), didn't retry on its own, and asked, because the user had approved 0 → 25, not 3 → 25.
- **Claude Code asks before read tools too.** `readOnlyHint` doesn't skip its prompt, and a dry run is prompted like a real write, because the host can't tell what `dryRun: true` means. Our `dryRun` protects the data; the host's prompt protects the call. A "don't ask again" on `set_stock` would cover real writes too.
- **One model slip:** a garbled SKU cell, corrected by the model itself in its next reply.
- **The data it changed:** `SEED-04007` (stock 0 → 40) and `SEED-04575` (stock 0 → 25), in the local stack only. The seed skips existing SKUs, so re-seeding doesn't undo them.
