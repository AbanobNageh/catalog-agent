import type { McpServer } from '@modelcontextprotocol/server';
import { setStockInput, setStockOutput } from '../schemas.js';
import { runTool, type ToolDeps } from '../tool-call.js';
import { CONDITIONAL_OVERWRITE } from './annotations.js';
import { conditionalSet, type SetField } from './conditional-set.js';

const NAME = 'set_stock';

const DESCRIPTION = `Set a product's stock to an absolute number of units. Not a change: stock 50 means 50 units in stock, whatever it was before.
Before calling: get_product, and send its version as expectedVersion. If the product changed since, this fails with STALE_VERSION and writes nothing; read it again and check the change still makes sense.
Call it with dryRun: true first, to see the current and proposed stock; apply it (dryRun: false) only after the user agrees.
Setting the stock a product already has writes nothing. The result has the new version, for the next change.`;

const STOCK: SetField<{ stock: number }> = {
  tool: NAME,
  field: 'stock',
  label: 'stock',
  values: (stock) => ({ stock }),
  show: (stock) => String(stock),
};

/** `set_stock`: PATCH {stock} with If-Match (REQUIREMENTS.md §4.2, ADR-0006). */
export function registerSetStock(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    NAME,
    {
      title: 'Set stock',
      description: DESCRIPTION,
      inputSchema: setStockInput,
      outputSchema: setStockOutput,
      annotations: CONDITIONAL_OVERWRITE,
    },
    ({ id, stock, expectedVersion, dryRun }, { mcpReq }) =>
      runTool(
        NAME,
        deps.logger,
        (ctx) =>
          conditionalSet(deps.client, ctx, STOCK, {
            id,
            value: stock,
            expectedVersion,
            dryRun,
          }),
        { signal: mcpReq.signal },
      ),
  );
}
