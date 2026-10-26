import type { McpServer } from '@modelcontextprotocol/server';
import type { Product } from '../../catalog/types.js';
import { formatPrice } from '../money.js';
import { toolSuccess } from '../results.js';
import {
  getProductInput,
  productOutput,
  type ProductOutput,
} from '../schemas.js';
import { runTool, type ToolDeps } from '../tool-call.js';
import { READ_ONLY } from './annotations.js';

const NAME = 'get_product';

const DESCRIPTION = `Get one product's full, current details by id: description, price, stock and version.
Read this before changing a product: its version is what a change must send back as expectedVersion, and search results can be a few seconds stale.
Prices are integer cents: priceCents 79900 = 799.00 EGP; "price" is the same, formatted.
Find ids with search_products.`;

/** The full product as get_product and create_product return it: the API's fields plus `price`. */
export function toProductOutput(p: Product): ProductOutput {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    brand: p.brand,
    priceCents: p.priceCents,
    price: formatPrice(p.priceCents, p.currency),
    currency: p.currency,
    stock: p.stock,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    version: p.version,
  };
}

/** `get_product`: GET /products/:id (REQUIREMENTS.md §4.2). */
export function registerGetProduct(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    NAME,
    {
      title: 'Get product',
      description: DESCRIPTION,
      inputSchema: getProductInput,
      outputSchema: productOutput,
      annotations: READ_ONLY,
    },
    ({ id }) =>
      runTool(NAME, deps.logger, async (ctx) => {
        const p = await deps.client.getProduct(id, ctx);
        const data = toProductOutput(p);
        return toolSuccess(
          `${p.name} (${p.sku}): ${data.price}, stock ${p.stock}, version ${p.version}.`,
          data,
        );
      }),
  );
}
