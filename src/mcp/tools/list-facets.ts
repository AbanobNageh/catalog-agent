import type { McpServer } from '@modelcontextprotocol/server';
import { toolSuccess } from '../results.js';
import {
  listFacetsInput,
  listFacetsOutput,
  type ListFacetsOutput,
} from '../schemas.js';
import { runTool, type ToolDeps } from '../tool-call.js';
import { READ_ONLY } from './annotations.js';
import { toFacets } from './search-products.js';

const NAME = 'list_facets';

const DESCRIPTION = `Count the matching products by category, brand and price bucket, optionally filtered. Returns counts only, no products.
Use it to discover valid category and brand names before filtering search_products, or to summarise part of the catalogue.
Shows the top 20 categories and the top 50 brands by count. Price buckets and the price filters are integer cents: 79900 = 799.00 EGP.`;

/** `list_facets`: a search with size=1 and the facets (REQUIREMENTS.md §4.2). */
export function registerListFacets(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    NAME,
    {
      title: 'List facets',
      description: DESCRIPTION,
      inputSchema: listFacetsInput,
      outputSchema: listFacetsOutput,
      annotations: READ_ONLY,
    },
    (filters) =>
      runTool(NAME, deps.logger, async (ctx) => {
        // size=1: the facets come with any search; one hit is the least to ask for.
        const result = await deps.client.search({ ...filters, size: 1 }, ctx);
        const data: ListFacetsOutput = {
          total: result.total,
          ...toFacets(result.facets),
        };
        return toolSuccess(summarize(data), data);
      }),
  );
}

function summarize(data: ListFacetsOutput): string {
  const n = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  return `${n(data.total, 'product matches', 'products match')}: ${n(data.categories.length, 'category', 'categories')}, ${n(data.brands.length, 'brand', 'brands')}, ${n(data.priceBuckets.length, 'price bucket', 'price buckets')}.`;
}
