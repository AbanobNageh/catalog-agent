import type { McpServer } from '@modelcontextprotocol/server';
import type {
  Bucket,
  PriceBucket,
  SearchHit,
  SearchResult,
} from '../../catalog/types.js';
import { formatPrice } from '../money.js';
import { toolSuccess } from '../results.js';
import {
  SEARCH_WINDOW,
  searchProductsInput,
  searchProductsOutput,
  type Facets,
  type SearchProductsOutput,
} from '../schemas.js';
import { runTool, type ToolDeps } from '../tool-call.js';
import { READ_ONLY } from './annotations.js';

const NAME = 'search_products';

const DESCRIPTION = `Search the product catalogue by free text and filters. Returns compact hits (no description, no version) with the total count and paging.
Use it to find products and their ids. Before changing a product, read it with get_product: search hits carry no version and can be a few seconds stale.
Prices are integer cents: priceCents 79900 = 799.00 EGP; each hit also has a formatted "price".
Low stock: maxStock with sort "stock_asc". For valid category and brand names, call list_facets first.
Paging: page and size (1-100, default 10), with page × size at most ${SEARCH_WINDOW}. When hasMore is true, nextPage is the page to ask for.`;

/** `search_products`: GET /products/search (REQUIREMENTS.md §4.2). */
export function registerSearchProducts(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    NAME,
    {
      title: 'Search products',
      description: DESCRIPTION,
      inputSchema: searchProductsInput,
      outputSchema: searchProductsOutput,
      annotations: READ_ONLY,
    },
    (args) =>
      runTool(NAME, deps.logger, async (ctx) => {
        const { includeFacets, ...params } = args;
        const result = await deps.client.search(params, ctx);
        const data = toOutput(result, args.page, args.size, includeFacets);
        return toolSuccess(summarize(data, result.hits.length), data);
      }),
  );
}

function toOutput(
  result: SearchResult,
  page: number,
  size: number,
  includeFacets: boolean,
): SearchProductsOutput {
  // hasMore: more matches exist after this page. nextPage only when that page
  // can be fetched: search-service stops at page × size = SEARCH_WINDOW.
  const hasMore = page * size < result.total;
  const canFetchNext = (page + 1) * size <= SEARCH_WINDOW;
  return {
    hits: result.hits.map(compact),
    total: result.total,
    page,
    size,
    hasMore,
    ...(hasMore && canFetchNext ? { nextPage: page + 1 } : {}),
    ...(includeFacets ? { facets: toFacets(result.facets) } : {}),
  };
}

/** A hit without the description and timestamps: small outputs (§4.2). */
function compact(hit: SearchHit) {
  return {
    id: hit.id,
    sku: hit.sku,
    name: hit.name,
    category: hit.category,
    brand: hit.brand,
    priceCents: hit.priceCents,
    price: formatPrice(hit.priceCents, hit.currency),
    currency: hit.currency,
    stock: hit.stock,
  };
}

/**
 * The facets in our names, copying only the fields the outputSchema allows:
 * a field catalog-api adds later must not reach strict clients, which reject
 * properties the schema doesn't list.
 */
export function toFacets(facets: SearchResult['facets']): Facets {
  const bucket = ({ key, count }: Bucket) => ({ key, count });
  return {
    categories: facets.category.map(bucket),
    brands: facets.brand.map(bucket),
    priceBuckets: facets.price.map(({ key, count, from, to }: PriceBucket) => ({
      key,
      count,
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    })),
  };
}

function summarize(data: SearchProductsOutput, shown: number): string {
  const { total, page, size } = data;
  if (total === 0) return 'No products match these filters.';
  const matches = total === 1 ? '1 product matches' : `${total} products match`;
  if (shown === 0) {
    const lastPage = Math.ceil(total / size);
    return `${matches}, but page ${page} is past the last page (${lastPage}).`;
  }
  const from = (page - 1) * size + 1;
  const range = `${matches}; showing ${from}–${from + shown - 1} (page ${page}).`;
  if (data.nextPage !== undefined) {
    return `${range} More: call ${NAME} with page: ${data.nextPage}.`;
  }
  if (data.hasMore) {
    return `${range} More match than search can page through (${SEARCH_WINDOW}); narrow the filters to see the rest.`;
  }
  return range;
}
