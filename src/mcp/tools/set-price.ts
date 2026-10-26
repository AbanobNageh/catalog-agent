import type { McpServer } from '@modelcontextprotocol/server';
import { formatPrice } from '../money.js';
import { setPriceInput, setPriceOutput } from '../schemas.js';
import { runTool, type ToolDeps } from '../tool-call.js';
import { CONDITIONAL_OVERWRITE } from './annotations.js';
import { conditionalSet, type SetField } from './conditional-set.js';

const NAME = 'set_price';

const DESCRIPTION = `Set a product's price, absolute, in integer cents: priceCents 79900 = 799.00 EGP. The currency stays the product's.
Before calling: get_product, and send its version as expectedVersion. If the product changed since, this fails with STALE_VERSION and writes nothing; read it again and check the change still makes sense.
Call it with dryRun: true first, to see the current and proposed price; apply it (dryRun: false) only after the user agrees.
Setting the price a product already has writes nothing. The result has the new version, for the next change.`;

type PriceValues = { priceCents: number; price: string; currency: string };

const PRICE: SetField<PriceValues> = {
  tool: NAME,
  field: 'priceCents',
  label: 'price',
  values: (priceCents, currency) => ({
    priceCents,
    price: formatPrice(priceCents, currency),
    currency,
  }),
  show: (priceCents, currency) =>
    `${formatPrice(priceCents, currency)} (${priceCents})`,
};

/** `set_price`: PATCH {priceCents} with If-Match (REQUIREMENTS.md §4.2, ADR-0006). */
export function registerSetPrice(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    NAME,
    {
      title: 'Set price',
      description: DESCRIPTION,
      inputSchema: setPriceInput,
      outputSchema: setPriceOutput,
      annotations: CONDITIONAL_OVERWRITE,
    },
    ({ id, priceCents, expectedVersion, dryRun }, { mcpReq }) =>
      runTool(
        NAME,
        deps.logger,
        (ctx) =>
          conditionalSet(deps.client, ctx, PRICE, {
            id,
            value: priceCents,
            expectedVersion,
            dryRun,
          }),
        { signal: mcpReq.signal },
      ),
  );
}
