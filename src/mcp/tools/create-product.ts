import type { McpServer } from '@modelcontextprotocol/server';
import type { NewProduct } from '../../catalog/types.js';
import { toolSuccess } from '../results.js';
import { createProductInput, productOutput } from '../schemas.js';
import { runTool, type ToolDeps } from '../tool-call.js';
import { ADDITIVE_WRITE } from './annotations.js';
import { toProductOutput } from './get-product.js';

const NAME = 'create_product';

const DESCRIPTION = `Create a new product in the catalogue. Use it only when the user asked for a new product; to change an existing one, use set_price or set_stock.
Prices are integer cents: priceCents 79900 = 799.00 EGP. Leave currency out for EGP.
The sku must be unique: a taken sku fails with SKU_EXISTS.
A create is never retried for you. If it fails with the outcome unknown, the product may exist: search_products by its name and category, sort newest, and look for its sku. A retry with the same sku can't create a duplicate (it gets SKU_EXISTS if the product exists); never change the sku to get past SKU_EXISTS.
Returns the new product with its id and version.`;

/**
 * After a timeout nobody can tell whether the product was created (ADR-0004),
 * and there's no lookup by SKU: `q` searches name and description only
 * (ADR-0006). So the hint names a search the model can make, newest first
 * because names repeat. Search can also miss a product whose index call
 * failed, so it adds the safe fallback: the sku is unique, so a retry with
 * the same one can't duplicate the product (review 4).
 */
const OUTCOME_UNKNOWN_HINT =
  'the product may have been created. Call search_products with q set to its name, category set to its category and sort newest, and look for its sku in the hits. If it is not there, retry with the same sku: that cannot create a duplicate, and SKU_EXISTS then means the product was created. Never change the sku to get past SKU_EXISTS';

/** `create_product`: POST /products, never retried (REQUIREMENTS.md §4.2, §4.4). */
export function registerCreateProduct(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    NAME,
    {
      title: 'Create product',
      description: DESCRIPTION,
      inputSchema: createProductInput,
      outputSchema: productOutput,
      annotations: ADDITIVE_WRITE,
    },
    ({ currency, ...fields }) =>
      runTool(
        NAME,
        deps.logger,
        async (ctx) => {
          // No currency key at all when it's left out: catalog-api defaults it.
          const input: NewProduct = {
            ...fields,
            ...(currency === undefined ? {} : { currency }),
          };
          const p = await deps.client.createProduct(input, ctx);
          const data = toProductOutput(p);
          return toolSuccess(
            `Created ${p.name} (${p.sku}): id ${p.id}, ${data.price}, stock ${p.stock}, version ${p.version}.`,
            data,
          );
        },
        { hints: { outcomeUnknown: OUTCOME_UNKNOWN_HINT } },
      ),
  );
}
